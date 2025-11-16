(async function(){
  // 1) World map
  const worldTopo = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then(r=>r.json());
  const world = topojson.feature(worldTopo, worldTopo.objects.countries);

  // 2) Earthquake data
  const parseDate = d3.timeParse("%m/%d/%Y");
  const parseDateTime = d3.timeParse("%m/%d/%Y %H:%M:%S");
  const data = await d3.csv("database.csv", d => {
    const dateObj = d.Date && d.Time ? parseDateTime(`${d.Date} ${d.Time}`) : parseDate(d.Date);
    // Try to read multiple possible column names for robustness
    const hdist = +d["Horizontal Distance1"] || +d["Horizontal Distance"] || NaN;
    const depth1 = Number.isFinite(+d["Depth1"]) ? +d["Depth1"] : +d["Depth"];
    return {
      lat:   +d.Latitude,
      lon:   +d.Longitude,
      mag:   +d.Magnitude,
      depth: +d.Depth,
      year:  dateObj ? dateObj.getUTCFullYear() : null,
      type:  (d.Type || "Unknown").trim(),
      hdist: Number.isFinite(hdist) ? hdist : NaN,
      depth1: Number.isFinite(depth1) ? depth1 : NaN,
      raw: d
    };
  });

  const clean = data.filter(d =>
    Number.isFinite(d.lat)  &&
    Number.isFinite(d.lon)  &&
    Number.isFinite(d.mag)  &&
    Number.isFinite(d.year)
  );

  // side panel mode: 'line' (default) or 'scatter'
  let sideMode = 'line';
  const toggleSide = document.getElementById('toggleSideMode');

  // 2.5) Plate density from all.csv
  let plateBase = [];
  try{
    const platesRaw = await d3.csv("all.csv", d => ({
      lat: +d.lat,
      lon: +d.lon,
      plate: (d.plate || "").trim()
    }));
    plateBase = platesRaw.filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lon));
  }catch(e){
    console.warn("Failed to load all.csv", e);
  }

  // Year control (default start from 1965, and initial range is 1965–1965)
  const years = clean.map(d => d.year);
  const yearMinData = d3.min(years);
  const yearMaxData = d3.max(years);
  const defaultStartYear = 1965;
  const startY = Math.max(defaultStartYear, yearMinData);

  const yearRange = document.getElementById('yearRange');
  const yearMinInp = document.getElementById('yearMin');
  const yearMaxInp = document.getElementById('yearMax');
  const yearBadge  = document.getElementById('yearBadge');

  yearRange.min = startY;        // slider lower bound 1965
  yearRange.max = yearMaxData;
  yearRange.value = startY;      // slider initial 1965
  yearMinInp.value = startY;     // left input 1965
  yearMaxInp.value = startY;     // right input 1965
  yearBadge.textContent = `${startY} – ${startY}`;

  // 3) Type filters (checkboxes)
  const typeSet = Array.from(new Set(clean.map(d => d.type))).sort();
  const typeFilters = d3.select('#typeFilters');
  typeSet.forEach(t => {
    const w = typeFilters.append('label')
      .style('display','inline-flex')
      .style('gap','6px')
      .style('align-items','center');
    w.append('input')
      .attr('type','checkbox')
      .attr('checked', true)
      .attr('value', t);
    w.append('span').text(t);
  });

  // 4) Projection + SVG layers
  const svg = d3.select('#map');
  const gMap    = svg.append('g');
  const gPlates = svg.append('g').attr('class','plate-layer');
  const gPoints = svg.append('g');
  const projection = d3.geoMercator().scale(1).translate([0,0]);
  const path = d3.geoPath(projection);

  function fitProjection(){
    const {width, height} = svg.node().getBoundingClientRect();
    projection.fitSize([width, height], world);
    gMap.selectAll('path')
      .data(world.features)
      .join('path')
      .attr('d', path)
      .attr('fill', '#f2f2f2')
      .attr('stroke', '#d6d6d6')
      .attr('stroke-width', .6);
  }

  svg.call(
    d3.zoom()
      .scaleExtent([1,8])
      .on('zoom', ev => {
        gMap.attr('transform', ev.transform);
        gPlates.attr('transform', ev.transform);
        gPoints.attr('transform', ev.transform);
      })
  );

  // 5) Visual scales (radius, color, quantiles)
  const r = d3.scaleSqrt()
    .domain(d3.extent(clean, d => d.mag))
    .range([1.5, 5]);

  const magsAll   = clean.map(d => d.mag).sort(d3.ascending);
  const magExtent = d3.extent(clean, d => d.mag);   // global magnitude extent for histogram

  const q1 = d3.quantile(magsAll, .33);
  const q2 = d3.quantile(magsAll, .66);
  const qColors  = ["#fee8c8", "#fdbb84", "#e34a33"];
  const colorQuant = d3.scaleThreshold()
    .domain([q1, q2])
    .range(qColors);
  const qBreaks = [d3.min(magsAll), q1, q2, d3.max(magsAll)];

  // 6) Tooltip
  const tooltip = d3.select('#tooltip');
  function showTooltip(ev, d){
    tooltip
      .style('opacity', 1)
      .style('left', (ev.pageX + 12) + "px")
      .style('top', (ev.pageY + 12) + "px")
      .html(
        `<div><strong>${d.type}</strong></div>` +
        `<div>Magnitude: ${d.mag.toFixed(1)}</div>` +
        `<div>Depth: ${Number.isFinite(d.depth) ? d.depth.toFixed(1)+' km' : '—'}</div>` +
        `<div>Lat/Lon: ${d.lat.toFixed(2)}, ${d.lon.toFixed(2)}</div>` +
        `<div>Year: ${d.year}</div>`
      );
  }
  function hideTooltip(){ tooltip.style('opacity', 0); }

  // 7) Helper: aggregate metrics by year
  function aggregateByYear(rows){
    const map = d3.rollup(
      rows,
      v => ({
        count: v.length,
        avgMag: d3.mean(v, d => d.mag)
      }),
      d => d.year
    );
    return Array.from(map, ([year, o]) => ({
      year: +year,
      count: o.count,
      avgMag: o.avgMag
    })).sort((a,b) => a.year - b.year);
  }

  // 8) Filter + render (main drawing routine)
  function activeTypes(){
    return new Set(
      Array.from(
        document.querySelectorAll('#typeFilters input[type="checkbox"]:checked')
      ).map(el => el.value)
    );
  }

  function filtered(){
    const minY = +yearMinInp.value;
    const maxY = +yearMaxInp.value;
    const tset = activeTypes();
    yearBadge.textContent = `${minY} – ${maxY}`;
    return clean.filter(d =>
      d.year >= minY &&
      d.year <= maxY &&
      tset.has(d.type)
    );
  }

  function render(){
    const pts = filtered();

    // map points
    gPoints.selectAll('circle')
      .data(pts, d => d.raw.ID || `${d.lat},${d.lon},${d.year},${d.mag}`)
      .join(
        enter => enter.append('circle')
          .attr('cx', d => projection([d.lon, d.lat])[0])
          .attr('cy', d => projection([d.lon, d.lat])[1])
          .attr('r', 0)
          .attr('fill', d => colorQuant(d.mag))
          .attr('stroke', '#a45c1b')
          .on('mousemove', showTooltip)
          .on('mouseleave', hideTooltip)
          .call(sel => sel.transition().duration(300).attr('r', d => r(d.mag))),
        update => update.call(sel => sel.transition().duration(200)
          .attr('cx', d => projection([d.lon, d.lat])[0])
          .attr('cy', d => projection([d.lon, d.lat])[1])
          .attr('r', d => r(d.mag))
          .attr('fill', d => colorQuant(d.mag))),
        exit => exit.transition().duration(200).attr('r', 0).remove()
      );

    // histogram (subset)
    renderMagnitudeHistogram(pts.map(d => d.mag), qBreaks, colorQuant);

    // side panel: line charts or scatter plots
    if (sideMode === 'line'){
      const yearly = aggregateByYear(pts);
      renderCountLine(yearly);
      renderAvgMagLine(yearly);
    }else{
      renderScatterPanels(pts);
    }

    // update titles
    const titleA = document.getElementById('cardTitleA');
    const titleB = document.getElementById('cardTitleB');
    if (sideMode === 'line'){
      titleA.textContent = 'Trends of Earthquake Events';
      titleB.textContent = 'Trends of Average Magnitude';
    }else{
      titleA.textContent = 'Magnitude vs. Horizontal Distance';
      titleB.textContent = 'Magnitude vs. Depth';
    }

    // density overlay
    const on = document.getElementById('togglePlates').checked;
    if (on && plateBase.length) drawPlateDensity(plateBase);
    else clearPlateMask();
  }

  // --- Side scatters (Magnitude vs Horizontal Distance / Depth) ---
  function renderScatterPanels(rows){
    drawScatter('#countLine', rows, d => d.hdist, 'Horizontal Distance');
    drawScatter('#avgMagLine', rows, d => d.depth1, 'Depth');
  }

  function drawScatter(sel, rows, xAccessor, xLabel){
    const svg = d3.select(sel);
    svg.selectAll('*').remove();

    const data = rows.filter(d =>
      Number.isFinite(xAccessor(d)) &&
      Number.isFinite(d.mag)
    );

    const w = svg.node().clientWidth  || 320;
    const h = svg.node().clientHeight || 220;
    const m = {t:16, r:10, b:30, l:38};

    if (data.length === 0){
      svg.append('text')
        .attr('x', w/2)
        .attr('y', h/2)
        .attr('text-anchor','middle')
        .attr('fill','#888')
        .text('No data');
      return;
    }

    const xMin = 0;
    const xMax = d3.max(data, xAccessor);
    const x = d3.scaleLinear()
      .domain([xMin, xMax]).nice()
      .range([m.l, w - m.r]);

    const y = d3.scaleLinear()
      .domain(d3.extent(data, d => d.mag)).nice()
      .range([h - m.b, m.t]);

    const g = svg.append('g');

    g.append('g')
      .attr('transform', `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x).ticks(5));

    g.append('g')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5));

    g.append('g').selectAll('circle')
      .data(data)
      .join('circle')
      .attr('cx', d => x(xAccessor(d)))
      .attr('cy', d => y(d.mag))
      .attr('r', 2)
      .attr('fill','#2c7fb8')
      .attr('opacity',0.6);

    // axis labels
    g.append('text')
      .attr('x', w/2)
      .attr('y', h - 6)
      .attr('text-anchor','middle')
      .attr('fill','#666')
      .attr('font-size',10)
      .text(xLabel);

    g.append('text')
      .attr('transform','rotate(-90)')
      .attr('x', -(h/2))
      .attr('y', 12)
      .attr('text-anchor','middle')
      .attr('fill','#666')
      .attr('font-size',10)
      .text('Magnitude');
  }

  // clamp helper
  function clampYears(){
    const lo = Math.max(startY, Math.min(+yearMinInp.value || startY,
                                         +yearMaxInp.value || startY));
    const hi = Math.min(+yearRange.max,
                        Math.max(+yearMaxInp.value || startY, lo));
    yearMinInp.value = lo;
    yearMaxInp.value = hi;
  }

  // Sync: slider controls the maximum year
  yearRange.addEventListener('input', () => {
    yearMaxInp.value = String(yearRange.value);
    clampYears();
    render();
  });

  // Sync: when numeric inputs change, update slider and re-render
  function syncFromInputs(){
    if (yearMinInp.value === '' || yearMaxInp.value === '') return; // avoid partial input
    const min = Math.floor(+yearMinInp.value);
    const max = Math.floor(+yearMaxInp.value);
    if (!Number.isNaN(min)) yearMinInp.value = String(min);
    if (!Number.isNaN(max)) yearMaxInp.value = String(max);
    clampYears();
    yearRange.value = yearMaxInp.value;
    render();
  }

  yearMinInp.addEventListener('input',  syncFromInputs);
  yearMaxInp.addEventListener('input',  syncFromInputs);
  yearMinInp.addEventListener('change', syncFromInputs);
  yearMaxInp.addEventListener('change', syncFromInputs);

  document
    .querySelectorAll('#typeFilters input[type="checkbox"]')
    .forEach(chk => chk.addEventListener('change', render));

  document
    .getElementById('togglePlates')
    .addEventListener('change', render);

  toggleSide.addEventListener('change', () => {
    sideMode = toggleSide.checked ? 'scatter' : 'line';
    render();
  });

  // Legend
  const legendRows = d3.select('#legendRows');
  function renderColorLegendQuantile(breaks, palette){
    legendRows.selectAll('*').remove();
    for (let i = 0; i < palette.length; i++){
      const low  = breaks[i].toFixed(1);
      const high = breaks[i+1].toFixed(1);
      const row = legendRows.append('div').attr('class','row');
      row.append('div')
        .attr('class','dot')
        .style('background', palette[i]);
      row.append('span').text(`${low} – ${high}`);
    }
  }

  // Histogram of magnitudes
  // Histogram of magnitudes
function renderMagnitudeHistogram(allMags, breaks, colorScale){
  const w = 260, h = 130, m = {t:16, r:12, b:26, l:34};
  const svgH = d3.select('#hist').attr('width', w).attr('height', h);
  svgH.selectAll('*').remove();

  if (!allMags || allMags.length === 0){
    svgH.append('text')
      .attr('x', w/2)
      .attr('y', h/2)
      .attr('text-anchor','middle')
      .attr('fill','#888')
      .attr('font-size',12)
      .text('No data');
    return;
  }

  // X axis: use global magExtent so the range stays consistent
  const x = d3.scaleLinear()
    .domain(magExtent)
    .nice()
    .range([m.l, w - m.r]);

  // Binning
  const bins = d3.bin()
    .domain(magExtent)
    .thresholds(20)(allMags);

  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, b => b.length)]).nice()
    .range([h - m.b, m.t]);

  const barPad    = 0.25;  // Gap ratio for regular bars
  const firstPad  = 0.10;  // Smaller gap for the first bar so it looks wider
  const leftGapPx = 4;     // Shift all bars slightly to the right

  const gBars = svgH.append('g');

  gBars.selectAll('rect')
    .data(bins)
    .join('rect')
    .attr('x', (d, i) => {
      const x0 = x(d.x0);
      const x1 = x(d.x1);
      const bw = x1 - x0;
      const pad = (i === 0) ? firstPad : barPad;
      return x0 + bw * pad / 2 + leftGapPx;
    })
    .attr('y', d => y(d.length))
    .attr('width', (d, i) => {
      const x0 = x(d.x0);
      const x1 = x(d.x1);
      const bw = x1 - x0;
      const pad = (i === 0) ? firstPad : barPad;
      return Math.max(0, bw * (1 - pad));
    })
    .attr('height', d => y(0) - y(d.length))
    .attr('fill', (d, i) =>
      i === 0
        ? '#fdd49e' // First bar: slightly darker than the original light orange, still lighter than the second and third bands
        : colorScale((d.x0 + d.x1) / 2)
    )
    .attr('stroke', '#e6e6e6');

  // X axis (magnitude)
  svgH.append('g')
    .attr('transform', `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).ticks(5))
    .selectAll('text')
    .style('font-size','10px');

  // Y axis (counts)
  svgH.append('g')
    .attr('transform', `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(4))
    .selectAll('text')
    .style('font-size','10px');

  // Title
  svgH.append('text')
    .attr('x', m.l)
    .attr('y', m.t - 6)
    .attr('fill','#444')
    .attr('font-weight',600)
    .attr('font-size',12)
    .text('Magnitude distribution');
}
  // Side line chart: event counts per year
  function renderCountLine(rows){
    const svg = d3.select('#countLine');
    svg.selectAll('*').remove();
    const w = svg.node().clientWidth  || 320;
    const h = svg.node().clientHeight || 220;
    const m = {t:16, r:10, b:28, l:36};

    const x = d3.scaleLinear()
      .domain(d3.extent(rows, d => d.year) || [startY,startY]).nice()
      .range([m.l, w - m.r]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(rows, d => d.count) || 1]).nice()
      .range([h - m.b, m.t]);

    const g = svg.append('g');

    g.append('g')
      .attr('transform', `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('d')));

    g.append('g')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5));

    const line = d3.line()
      .x(d => x(d.year))
      .y(d => y(d.count));

    g.append('path')
      .datum(rows)
      .attr('fill','none')
      .attr('stroke','#2c7fb8')
      .attr('stroke-width',1.8)
      .attr('d', line);
  }

  // Side line chart: average magnitude per year
  function renderAvgMagLine(rows){
    const svg = d3.select('#avgMagLine');
    svg.selectAll('*').remove();
    const w = svg.node().clientWidth  || 320;
    const h = svg.node().clientHeight || 220;
    const m = {t:16, r:10, b:28, l:36};

    const x = d3.scaleLinear()
      .domain(d3.extent(rows, d => d.year) || [startY,startY]).nice()
      .range([m.l, w - m.r]);

    const y = d3.scaleLinear()
      .domain([
        d3.min(rows, d => d.avgMag) || 5,
        d3.max(rows, d => d.avgMag) || 6
      ]).nice()
      .range([h - m.b, m.t]);

    const g = svg.append('g');

    g.append('g')
      .attr('transform', `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('d')));

    g.append('g')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5));

    const line = d3.line()
      .x(d => x(d.year))
      .y(d => y(d.avgMag));

    g.append('path')
      .datum(rows)
      .attr('fill','none')
      .attr('stroke','#d95f0e')
      .attr('stroke-width',1.8)
      .attr('d', line);
  }

  // Plate density (contour) overlay
  function drawPlateDensity(pts){
    const {width, height} = d3.select('#map').node().getBoundingClientRect();
    gPlates.selectAll('*').remove();
    if (!pts || pts.length < 5) return;

    const geo = d3.geoPath();
    const base = d3.contourDensity()
      .x(d => projection([d.lon,d.lat])[0])
      .y(d => projection([d.lon,d.lat])[1])
      .size([width,height])
      .bandwidth(46)
      .thresholds(12)(pts);

    gPlates.append('g').selectAll('path')
      .data(base)
      .join('path')
      .attr('d', geo)
      .attr('fill','#93c5fd')
      .attr('fill-opacity', .18)
      .attr('stroke','none');

    const core = d3.contourDensity()
      .x(d => projection([d.lon,d.lat])[0])
      .y(d => projection([d.lon,d.lat])[1])
      .size([width,height])
      .bandwidth(26)
      .thresholds(16)(pts);

    const maxV = d3.max(core, d => d.value) || 1;
    const alpha = d3.scalePow().exponent(.6)
      .domain([0, maxV])
      .range([.2, .5]);

    gPlates.append('g').selectAll('path')
      .data(core)
      .join('path')
      .attr('d', geo)
      .attr('fill','#60a5fa')
      .attr('fill-opacity', d => alpha(d.value))
      .attr('stroke','none')
      .style('mix-blend-mode','multiply');
  }

  function clearPlateMask(){
    gPlates.selectAll('*').remove();
  }

  // Initialization
  fitProjection();
  renderColorLegendQuantile(qBreaks,qColors);
  renderMagnitudeHistogram(magsAll, qBreaks, colorQuant);
  render();

  window.addEventListener('resize', () => {
    fitProjection();
    render();
  });
})();