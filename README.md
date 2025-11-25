
# Seismic Analysis — Interactive Earthquake Visualization (D3.js)

This project is an interactive visualization of global earthquake activity (1900–2016) built with **D3.js v7**. It provides intuitive tools to explore earthquakes across **time**, **location**, **magnitude**, **depth**, and **event types**, supported by interactive filtering and dynamic visual encodings.

---

## 🔍 Key Features

### **1. Global Earthquake Map**
- Earthquakes plotted by geographic coordinates.
- Circle radius encodes magnitude; color encodes quantile-based magnitude bins.
- Zoom and pan supported.
- Tooltip provides magnitude, depth, location, year, and event type.
- The map dynamically updates when:
  - Time range changes  
  - Event type filters change  
  - User selects years in the line chart  

---

### **2. Interactive Time Range Control**
- Synchronized numeric inputs and slider.
- Default view loads **full range (1965–2016)**.
- Line-chart year markers are clickable:
  - Clicking one year filters the map to that year.
  - Clicking two years selects a year interval.
  - Clicking a selected point again cancels it.

---

### **3. Event Type Filters**
Users may toggle the visibility of:
- Earthquake  
- Explosion  
- Nuclear Explosion  
- Rock Burst  

All views (map, histogram, line chart, bar chart, scatter plots) update accordingly.

---

### **4. Magnitude Distribution Histogram**
- Uses global magnitude extent for consistent axes.
- Bins magnitude into 20 intervals.
- Color follows quantile thresholds.
- Auto-updates based on active filters.

---

### **5. Trends Line Chart (Updated)**
- When **no event type is selected**, the chart displays **multiple lines**, one per type, each using consistent color coding.
- When a **specific type is selected**, only its trend line is shown.
- Each year is represented by a point, which can be clicked to filter the map.
- A dynamic legend is generated based on currently displayed event types.

---

### **6. Average Magnitude Bar Chart (Updated)**
- Displays average magnitude for each event type within the active time range.
- Bar colors match the type-filter color scheme.
- Labels are horizontal for improved readability.
- Clicking a bar:
  - Filters the entire visualization to that event type.
  - Clicking again resets to all types.

---

### **7. Scatter Plot Mode (Updated)**
Two scatterplots are available:
- **Magnitude vs. Horizontal Distance**
- **Magnitude vs. Depth**

Updates include:
- Scatter points now use event-type color mapping.
- When switching to scatter mode, the time range resets to the full range for clarity.

---

### **8. Density Overlay**
Optional tectonic-density visualization using contour density estimation:
- Highlights plate boundaries and high-density clusters.
- Toggle switch provided.

---

## 🧭 Design Improvements (Final Revision)
- Side panels not essential to core interaction are visually hidden for a cleaner layout.
- Centered layout for main chart area.
- Added legend for the trends line chart.
- Improved axis readability and spacing.
- Unified interaction patterns (click toggles, highlighting, interval filtering).

---

## 🗂 Project Structure

```
Seismic Analysis/
│── index.html
│── style.css            # Updated styling, centered layout, panel hiding
│── script.js            # Enhanced filtering, legend, multi-line trends, scatter logic
│── database.csv
│── all.csv
│── README.md
```

---

## 📦 Setup

Clone the repository:

```
git clone https://github.com/YOUR_USERNAME/seismic-analysis.git
cd seismic-analysis
```

Start a local server (CSV loading requires HTTP):

```
python3 -m http.server
```

Open:

```
http://localhost:8000/
```

---

## 👥 Contributors
- Yu-Chun Lai  
- Sanjeev Sharma  
- Connor McGrath  
