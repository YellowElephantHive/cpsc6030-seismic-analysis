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
    Number.isFinite(d.year) &&
    d.type !== 'Rock Burst' &&
    d.type !== 'Rock Blast'
  );

  // side panel mode: 'line' (default) or 'scatter'
  let sideMode = 'line';
  let selectedType = null; // currently selected type from the barchart (or null = all)
  let selectedMagRange = null; // currently selected magnitude bin {min, max} from the histogram
  const toggleSide = document.getElementById('toggleSideMode');
  let pickedYears = new Set();          // Currently selected years (0, 1, or 2 years)
  let baseYearRange = null;

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
  yearRange.max = yearMaxData;   // slider upper bound last data year
  yearRange.value = yearMaxData; // slider starts at the latest year

  // numeric inputs: start from full range [startY, yearMaxData]
  yearMinInp.value = startY;     // left input = earliest year (1965)
  yearMaxInp.value = yearMaxData;// right input = latest year (e.g., 2016)

  // badge shows the full range on load
  yearBadge.textContent = `${startY} – ${yearMaxData}`;

  // 3) Type filters (checkboxes)
  const typeSet = Array.from(new Set(clean.map(d => d.type))).sort();

  // Color scale for event types (used by barchart + line chart)
  const typeColor = d3.scaleOrdinal()
    .domain(typeSet)
    .range(d3.schemeSet2 ? d3.schemeSet2.slice(0, typeSet.length) :
      [
        "#66c2a5","#fc8d62","#8da0cb","#e78ac3","#a6d854","#ffd92f","#e5c494","#b3b3b3"
      ].slice(0,typeSet.length)
    );

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

  // Base filter: only year range + type checkboxes
  function baseFilteredCore(){
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

  // Extended filter: apply magnitude range if selected, using per-bin min/max
  function baseFiltered(){
    const core = baseFilteredCore();
    if (!selectedMagRange) return core;
    return core.filter(d =>
      d.mag >= selectedMagRange.min &&
      d.mag <  selectedMagRange.max + 1e-6
    );
  }

  function filtered(){
    const base = baseFiltered();
    if (!selectedType) return base;
    return base.filter(d => d.type === selectedType);
  }

  function render(){
    // baseCore: respects current yearMin/yearMax + type checkboxes (for histogram / bar)
    const baseCore = baseFilteredCore();

    // baseMap: additionally applies magnitude filter for map / side panels
    const baseMap = selectedMagRange
      ? baseCore.filter(d =>
          d.mag >= selectedMagRange.min &&
          d.mag <  selectedMagRange.max + 1e-6
        )
      : baseCore;

    const pts  = selectedType ? baseMap.filter(d => d.type === selectedType) : baseMap;

    // baseLine: ignores yearMin/yearMax, but follows type checkboxes AND magnitude selection
    const tsetForLine = activeTypes();
    let baseLine = clean.filter(d => tsetForLine.has(d.type));

    if (selectedMagRange) {
      baseLine = baseLine.filter(d =>
      d.mag >= selectedMagRange.min &&
      d.mag <  selectedMagRange.max + 1e-6
      );
    }

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

    // histogram: use full distribution under year + type filters (no mag filter),
    // but visually highlight the selected magnitude bin
    renderMagnitudeHistogram(baseCore.map(d => d.mag), qBreaks, colorQuant);

    if (sideMode === 'line'){
      if (selectedType){
        // Single type: use the full time span but only for the currently selected type
        const yearly = aggregateByYear(baseLine.filter(d => d.type === selectedType));
        renderCountLine(yearly, selectedType);
      }else{
        // Multiple types: use the full time span for all types
        renderCountLineAllTypes(baseLine);
      }
      // The barchart still follows the current yearMin/yearMax range
      renderTypeBar(baseMap);
    }else{
      renderScatterPanels(pts);
    }

    // update titles
    const titleA = document.getElementById('cardTitleA');
    const titleB = document.getElementById('cardTitleB');
    if (sideMode === 'line'){
      titleA.textContent = selectedType
        ? `Trends of ${selectedType} Events`
        : 'Trends of Events by Type';
      titleB.textContent = 'Magnitude distribution';
    }else{
      titleA.textContent = 'Magnitude vs. Horizontal Distance';
      titleB.textContent = 'Magnitude vs. Depth';
    }

    const legendBox = document.getElementById('legend');
    if (legendBox){
      legendBox.style.display = (sideMode === 'line') ? 'block' : 'none';
    }

    // density overlay (unchanged)
    const on = document.getElementById('togglePlates').checked;
    if (on && plateBase.length) drawPlateDensity(plateBase);
    else clearPlateMask();
  }

  // --- Side scatters (Magnitude vs Horizontal Distance / Depth) ---
  function renderScatterPanels(rows){
    drawScatter('#countLine', rows, d => d.hdist, 'Horizontal Distance');
    drawScatter('#hist', rows, d => d.depth1, 'Depth');
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

    // ⇨ Only update baseYearRange when there is no time filter from the line chart
    if (pickedYears.size === 0) {
      baseYearRange = {
        min: +yearMinInp.value,
        max: +yearMaxInp.value
      };
    }

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

    if (pickedYears.size === 0) {
      baseYearRange = {
        min: +yearMinInp.value,
        max: +yearMaxInp.value
      };
    }

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
  const svgH = d3.select('#hist');
  svgH.selectAll('*').remove();

  // 用實際 SVG 尺寸
  const w = svgH.node().clientWidth  || 320;
  const h = svgH.node().clientHeight || 220;
  const m = { t:16, r:12, b:26, l:34 };

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

  // Use the global magExtent so the X range stays consistent
  const x = d3.scaleLinear()
    .domain(magExtent)
    .nice()
    .range([m.l, w - m.r]);

  // 20 equal-width bins (preserving the overall shape)
  const bins = d3.bin()
    .domain(magExtent)
    .thresholds(20)(allMags);

  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, b => b.length)]).nice()
    .range([h - m.b, m.t]);

  const barPad    = 0.25;
  const firstPad  = 0.10;
  const leftGapPx = 4;

  const gBars = svgH.append('g');

  // Use breaks to define quantile boundaries (consistent with the legend)
  const q1 = breaks[1];
  const q2 = breaks[2];

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
        ? '#fdd49e'
        : colorScale((d.x0 + d.x1) / 2)
    )
    // Highlight the selected bin and dim the others (based on binMin/binMax)
    .attr('opacity', d => {
      if (!selectedMagRange) return 1;
      return (d.x0 === selectedMagRange.binMin && d.x1 === selectedMagRange.binMax) ? 1 : 0.35;
    })
    .attr('stroke', d => {
      if (!selectedMagRange) return '#e6e6e6';
      return (d.x0 === selectedMagRange.binMin && d.x1 === selectedMagRange.binMax)
        ? '#333'
        : '#e6e6e6';
    })
    .attr('stroke-width', d => {
      if (!selectedMagRange) return 1;
      return (d.x0 === selectedMagRange.binMin && d.x1 === selectedMagRange.binMax) ? 1.5 : 1;
    })
    .style('cursor', 'pointer')
    .on('click', (ev, d) => {
      // Toggle by bin identity (x0/x1)
      const isSame =
        selectedMagRange &&
        selectedMagRange.binMin === d.x0 &&
        selectedMagRange.binMax === d.x1;

      if (isSame){
        selectedMagRange = null;
      }else{
        // Decide which quantile band this bin belongs to based on its center
        const mid  = (d.x0 + d.x1) / 2;
        const band = (mid < q1) ? 0 : (mid < q2 ? 1 : 2);

        // Quantile band boundaries
        const bandMin = (band === 0 ? magExtent[0] : (band === 1 ? q1 : q2));
        const bandMax = (band === 0 ? q1 : (band === 1 ? q2 : magExtent[1]));

        // Effective numeric filter range: bin range clipped to its band
        const min = Math.max(d.x0, bandMin);
        const max = Math.min(d.x1, bandMax);

        selectedMagRange = {
          min,    // used for filtering earthquakes
          max,
          binMin: d.x0, // used for bar highlighting
          binMax: d.x1
        };
      }
      render();
    });

  // X Axis
  svgH.append('g')
    .attr('transform', `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).ticks(5))
    .selectAll('text')
    .style('font-size','10px');

  // Y Axis
  svgH.append('g')
    .attr('transform', `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(4))
    .selectAll('text')
    .style('font-size','10px');
}

    // ⇨ When a year is clicked in the line chart, update yearMin / yearMax / slider and pickedYears
function toggleYearFromLine(year) {
  year = +year;

  // 1. If two different years are already selected and a third different year is clicked, ignore it
  //    - Allowed cases: clicking an already selected year (to unselect), or when fewer than 2 years are selected
  if (!pickedYears.has(year) && pickedYears.size >= 2) {
    return;
  }

  // 2) If no year was previously selected, this is the first time the line chart is used as a time filter
  if (pickedYears.size === 0) {
    // Save the current input/slider range for restoration upon clearing
    baseYearRange = {
      min: +yearMinInp.value,
      max: +yearMaxInp.value
    };
  }

  // 3) Toggle this year
  if (pickedYears.has(year)) {
    pickedYears.delete(year);
  } else {
    pickedYears.add(year);
  }

  // 4) Update yearMin / yearMax / slider based on pickedYears
  if (pickedYears.size === 0) {
    // ➜ All years cleared: return to the state without a line-chart-based time filter
    const restoreMin = baseYearRange ? baseYearRange.min : startY;
    const restoreMax = baseYearRange ? baseYearRange.max : yearMaxData;

    yearMinInp.value = restoreMin;
    yearMaxInp.value = restoreMax;
    yearRange.value  = restoreMax;
    yearBadge.textContent = `${restoreMin} – ${restoreMax}`;
    baseYearRange = null; // Clear backup
  } else {
    // ➜ Still have selected years: use min / max as the current time range
    const arr = Array.from(pickedYears);
    const minY = d3.min(arr);
    const maxY = d3.max(arr);

    yearMinInp.value = minY;
    yearMaxInp.value = maxY;
    yearRange.value  = maxY;
    yearBadge.textContent = `${minY} – ${maxY}`;
  }

  // 5) Re-render all views (map, line chart, etc.)
  render();
}

// Helper to draw the year selection overlay after toggleYearFromLine(...)
function drawYearSelectionOverlay(g, x, w, h, m){
  if (pickedYears.size === 0) return;

  const yearsSel = Array.from(pickedYears).sort(d3.ascending);
  const xStart = m.l;
  const xEnd   = w - m.r;
  const yTop   = m.t;
  const yBot   = h - m.b;

  const layer = g.append('g')
    .attr('class', 'year-selection-layer')
    .style('pointer-events', 'none');

  // 1) First draw vertical red lines (one or two)
  yearsSel.forEach(yr => {
    const xPos = x(yr);
    if (!Number.isFinite(xPos)) return;
    layer.append('line')
      .attr('x1', xPos)
      .attr('x2', xPos)
      .attr('y1', yTop)
      .attr('y2', yBot)
      .attr('stroke', '#d62728')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,3');
  });

  // 2) If exactly two years are selected, dim the regions outside the interval
  if (yearsSel.length === 2){
    const minY = yearsSel[0];
    const maxY = yearsSel[1];
    const xMin = x(minY);
    const xMax = x(maxY);

    // Left side (years before the minimum selected year)
    const leftW = xMin - xStart;
    if (leftW > 0){
      layer.append('rect')
        .attr('x', xStart)
        .attr('y', yTop)
        .attr('width', leftW)
        .attr('height', yBot - yTop)
        .attr('fill', 'rgba(0,0,0,0.05)');
    }

    // Right side (years after the maximum selected year)
    const rightW = xEnd - xMax;
    if (rightW > 0){
      layer.append('rect')
        .attr('x', xMax)
        .attr('y', yTop)
        .attr('width', rightW)
        .attr('height', yBot - yTop)
        .attr('fill', 'rgba(0,0,0,0.05)');
    }
  }
}

  function renderCountLine(rows, typeForColor){
  const svg = d3.select('#countLine');
  svg.selectAll('*').remove();
  const w = svg.node().clientWidth  || 320;
  const h = svg.node().clientHeight || 220;
  const m = {t:16, r:10, b:28, l:36};

  if (!rows || rows.length === 0){
    svg.append('text')
      .attr('x', w/2)
      .attr('y', h/2)
      .attr('text-anchor','middle')
      .attr('fill','#888')
      .text('No data');
    return;
  }

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

  // Add vertical lines here and dim the regions outside the selected interval
  drawYearSelectionOverlay(g, x, w, h, m);

  const strokeColor = typeForColor && typeColor.domain().includes(typeForColor)
    ? typeColor(typeForColor)
    : '#2c7fb8';

  // Line: only meaningful when there are at least 2 years
  if (rows.length > 1){
    const line = d3.line()
      .defined(d => Number.isFinite(d.year) && Number.isFinite(d.count))
      .x(d => x(d.year))
      .y(d => y(d.count));

    g.append('path')
      .datum(rows)
      .attr('fill','none')
      .attr('stroke', strokeColor)
      .attr('stroke-width',1.8)
      .attr('d', line);
  }

  // Points: always draw one point per year with its event count
  g.append('g').selectAll('circle')
    .data(rows)
    .join('circle')
    .attr('cx', d => x(d.year))
    .attr('cy', d => y(d.count))
    .attr('r', d => pickedYears.has(d.year) ? 6 : 3)   // ⇨ 被選年份點變大
    .attr('fill', strokeColor)
    .attr('stroke', '#fff')
    .attr('stroke-width', d => pickedYears.has(d.year) ? 2 : 1)
    .style('cursor', 'pointer')
    .on('mousemove', (ev, d) => {
      tooltip
        .style('opacity', 1)
        .style('left', (ev.pageX + 12) + 'px')
        .style('top', (ev.pageY + 12) + 'px')
        .html(
          `<div><strong>${typeForColor || 'All types'}</strong></div>` +
          `<div>Year: ${d.year}</div>` +
          `<div>Event count: ${d.count}</div>`
        );
    })
    .on('mouseleave', () => {
      tooltip.style('opacity', 0);
    })
    .on('click', (ev, d) => {
      // ⇨ Clicking this year starts or updates the time filter
      toggleYearFromLine(d.year);
    });

  // --- Legend for single-type line chart ---
  const legend = g.append('g')
    .attr('class', 'line-legend')
    .attr('transform', `translate(${w - m.r - 110},${m.t - 10})`);

  const label = typeForColor || 'All types';
  const legendColor = typeForColor && typeColor.domain().includes(typeForColor)
    ? typeColor(typeForColor)
    : strokeColor;

  const item = legend.append('g')
    .attr('class', 'legend-item');

  item.append('rect')
    .attr('x', 0)
    .attr('y', -10)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', legendColor)
    .attr('stroke', '#333')
    .attr('stroke-width', 0.5);

  item.append('text')
    .attr('x', 18)
    .attr('y', 0)
    .attr('alignment-baseline', 'middle')
    .attr('fill', '#444')
    .style('font-size', '11px')
    .text(label);
}

  function renderCountLineAllTypes(rows){
  const svg = d3.select('#countLine');
  svg.selectAll('*').remove();
  const w = svg.node().clientWidth  || 320;
  const h = svg.node().clientHeight || 220;
  const m = {t:16, r:10, b:28, l:36};

  // rows are raw events (including type and year)
  const roll = d3.rollup(
    rows,
    v => v.length,      // Number of events per year
    d => d.type,
    d => d.year
  );

  const series = Array.from(
    roll,
    ([type, yearMap]) => ({
      type,
      values: Array.from(
        yearMap,
        ([year, count]) => ({ year: +year, count })
      ).sort((a, b) => a.year - b.year)
    })
  ).sort((a, b) => typeSet.indexOf(a.type) - typeSet.indexOf(b.type));

  const allPoints = series.flatMap(s => s.values);
  if (!allPoints.length){
    svg.append('text')
      .attr('x', w/2)
      .attr('y', h/2)
      .attr('text-anchor','middle')
      .attr('fill','#888')
      .text('No data');
    return;
  }

  const x = d3.scaleLinear()
    .domain(d3.extent(allPoints, d => d.year) || [startY,startY])
    .nice()
    .range([m.l, w - m.r]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(allPoints, d => d.count) || 1])
    .nice()
    .range([h - m.b, m.t]);

  const g = svg.append('g');

  g.append('g')
    .attr('transform', `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('d')));

  g.append('g')
    .attr('transform', `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(5));

  // Add vertical lines and dim the regions outside the selected interval
  drawYearSelectionOverlay(g, x, w, h, m);

  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.count));

  const seriesG = g.append('g')
    .selectAll('g.series')
    .data(series)
    .join('g')
    .attr('class','series');

  // Lines
  seriesG.append('path')
    .attr('fill','none')
    .attr('stroke', d => typeColor(d.type))
    .attr('stroke-width',1.8)
    .attr('opacity',0.9)
    .attr('d', d => line(d.values));

  // Points
  seriesG.append('g')
    .selectAll('circle')
    .data(d => d.values.map(v => ({ ...v, type: d.type })))
    .join('circle')
    .attr('cx', d => x(d.year))
    .attr('cy', d => y(d.count))
    .attr('r', d => pickedYears.has(d.year) ? 6 : 3)       // ⇨ Enlarge points for selected years
    .attr('fill', d => typeColor(d.type))
    .attr('stroke','#fff')
    .attr('stroke-width', d => pickedYears.has(d.year) ? 2 : 1)
    .attr('opacity',0.9)
    .style('cursor','pointer')
    .on('mousemove', (ev, d) => {
      tooltip
        .style('opacity', 1)
        .style('left', (ev.pageX + 12) + 'px')
        .style('top', (ev.pageY + 12) + 'px')
        .html(
          `<div><strong>${d.type}</strong></div>` +
          `<div>Year: ${d.year}</div>` +
          `<div>Event count: ${d.count}</div>`
        );
    })
    .on('mouseleave', () => {
      tooltip.style('opacity', 0);
    })
    .on('click', (ev, d) => {
      // ⇨ Use the same logic to toggle the selected year
      toggleYearFromLine(d.year);
    });

  // --- Legend for multi-type line chart ---
  const legend = g.append('g')
    .attr('class', 'line-legend')
    .attr('transform', `translate(${w - m.r - 110},${m.t - 10})`);

  const legendItems = series.map(s => s.type);

  legend.selectAll('g.legend-item')
    .data(legendItems)
    .join('g')
    .attr('class', 'legend-item')
    .attr('transform', (d,i) => `translate(0, ${i * 18})`)
    .each(function(d){
      const item = d3.select(this);
      item.append('rect')
        .attr('x', 0)
        .attr('y', -10)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', typeColor(d))
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5);

      item.append('text')
        .attr('x', 18)
        .attr('y', 0)
        .attr('alignment-baseline', 'middle')
        .attr('fill', '#444')
        .style('font-size', '11px')
        .text(d);
    });
}

  // Bottom panel (line mode): average magnitude by type (barchart)
  function renderTypeBar(rows){
    const svg = d3.select('#avgMagLine');
    svg.selectAll('*').remove();

    const w = svg.node().clientWidth  || 320;
    const h = svg.node().clientHeight || 220;
    const m = {t:16, r:10, b:32, l:44};

    // Aggregate by type: average magnitude + count
    const aggregated = Array.from(
      d3.rollup(
        rows,
        v => ({
          avgMag: d3.mean(v, d => d.mag),
          count: v.length
        }),
        d => d.type
      ),
      ([type, v]) => ({ type, avgMag: v.avgMag, count: v.count })
    ).sort((a,b) => typeSet.indexOf(a.type) - typeSet.indexOf(b.type));

    if (aggregated.length === 0){
      svg.append('text')
        .attr('x', w/2)
        .attr('y', h/2)
        .attr('text-anchor','middle')
        .attr('fill','#888')
        .text('No data');
      return;
    }

    const x = d3.scaleBand()
      .domain(aggregated.map(d => d.type))
      .range([m.l, w - m.r])
      .padding(0.25);

    // Fix y-axis range to 0–7
    const y = d3.scaleLinear()
      .domain([0, 7])
      .nice()
      .range([h - m.b, m.t]);

    const g = svg.append('g');

    g.append('g')
      .attr('transform', `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .style('font-size', '10px')
      .attr('text-anchor', 'middle')   
      .attr('transform', null);        

    g.append('g')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5));

    g.append('g').selectAll('rect')
      .data(aggregated, d => d.type)
      .join('rect')
      .attr('x', d => x(d.type))
      .attr('width', x.bandwidth())
      .attr('y', d => y(d.avgMag))
      .attr('height', d => y(0) - y(d.avgMag))
      .attr('fill', d => typeColor(d.type))
      .attr('opacity', d => !selectedType || selectedType === d.type ? 1 : 0.35)
      .attr('stroke', d => selectedType === d.type ? '#333' : 'none')
      .attr('stroke-width', d => selectedType === d.type ? 1.5 : 0)
      .style('cursor','pointer')
      .on('mousemove', (ev, d) => {
        tooltip
          .style('opacity', 1)
          .style('left', (ev.pageX + 12) + 'px')
          .style('top', (ev.pageY + 12) + 'px')
          .html(
            `<div><strong>${d.type}</strong></div>` +
            `<div>Average magnitude: ${d.avgMag.toFixed(2)}</div>` +
            `<div>Count: ${d.count}</div>`
          );
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', 0);
      })
      .on('click', (ev, d) => {
        // Toggle selection
        selectedType = (selectedType === d.type) ? null : d.type;
        render();
      });

    // Y axis label
    g.append('text')
      .attr('transform','rotate(-90)')
      .attr('x', -(h/2))
      .attr('y', 14)
      .attr('text-anchor','middle')
      .attr('fill','#666')
      .attr('font-size',10)
      .text('Average magnitude');
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