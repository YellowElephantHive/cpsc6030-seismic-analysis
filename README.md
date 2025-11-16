

# Seismic Analysis — Earthquake Visualization with D3.js

This project is an interactive visualization of global earthquake activity from 1900–2016, built using D3.js v7. It allows users to explore seismic patterns across space, time, magnitude, depth, and tectonic structure through a set of dynamic, interactive components.

The visualization aims to make earthquake patterns intuitive, interactive, and scientifically meaningful, while providing a flexible tool for exploring large-scale seismic datasets.

## Features Overview

### 1. Global Earthquake Map
- Earthquakes displayed using geographic coordinates.
- Circle size encodes magnitude; color encodes quantile-based magnitude bins.
- Zoom and pan interactions.
- Tooltip showing magnitude, depth, coordinates, date, and event type.

### 2. Density Overlay
A toggleable density layer generated using contour density estimation, highlighting:
- High-density seismic zones
- Plate tectonic structures
- Subduction boundaries

### 3. Magnitude Distribution Histogram
A histogram that updates with filters:
- Uses quantile-based color mapping
- Includes refined spacing to improve readability

### 4. Side Panel — Line Mode
Two line charts for temporal trends:
1. Trends of Earthquake Events  
2. Trends of Average Magnitude

### 5. Side Panel — Scatter Mode
Scatterplots that replace the line charts on toggle:
- Magnitude vs. Horizontal Distance  
- Magnitude vs. Depth  

### 6. Interactive Time Filter
Includes numeric inputs and a synchronized slider.  
Enables analysis of historical ranges, decades, or short periods.

### 7. Earthquake Type Filters
Users can toggle visibility for:
- Earthquake
- Explosion
- Nuclear Explosion
- Rock Burst

## Design Evolution

### Initial Concepts
Early designs used raw scatterplots without geographic context. While technically correct, the lack of a basemap made the patterns difficult to interpret.

### Adding the Basemap
Introducing a world map transformed the interpretability of the scatterplots. Patterns such as the Pacific Ring of Fire became immediately clear.

### Incorporating Plate Boundaries
Overlaying tectonic boundaries highlighted the strong alignment between earthquakes and plate structures. Adjustments were made to balance visual clarity and avoid clutter.

### Interactivity Enhancements
To address density and clutter, the following were introduced:
- Year filtering
- Magnitude and type filtering
- Dynamic panels and tooltips

These additions shifted the visualization from static to fully interactive.

### Final Additions
The final version includes:
- Density overlays
- Magnitude histograms
- Flexible side panel modes
- Improved filtering and tooltips

## Evaluation

### Strengths
- Effectively communicates spatial relationships between earthquakes and tectonic plates.
- Filtering tools reveal temporal and magnitude-based patterns.
- Scatterplots help explain relationships between depth, magnitude, and horizontal distance.

### Areas for Improvement
- Map becomes crowded when all data points are shown at once.
- Possible additions:
  - Data clustering or aggregation
  - Animated playback of earthquake events over time
  - Integration with real-time USGS data
  - Annotated plate regions or seismic hotspots

Overall, the project successfully visualizes seismic patterns in an accessible and interactive manner.

## Setup and Installation

Clone the repository:

```
git clone https://github.com/YOUR_USERNAME/seismic-analysis.git
cd seismic-analysis
```

Start a local server (required for CSV loading):

```
python3 -m http.server
```

Then open:

```
http://localhost:8000/
```

## Project Structure

```
Seismic Analysis/
│── index.html
│── style.css
│── script.js
│── database.csv
│── all.csv
│── README.md
```

## Contributors

- Yu-Chun Lai
- Sanjeev Sharma
- Connor Mcgrath