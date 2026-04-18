# Swiss Topo Vector Tiles Implementation

## Overview

The `ConnectionMap` component has been updated to use **Swiss Topo Vector Tiles** with **MapLibre GL** as the base map renderer. This replaces the previous WMTS tile-based approach with modern vector tiles.

## Key Changes

### 1. **Switched from Leaflet to MapLibre GL**
- **Previous**: Used `react-leaflet` with WMTS tiles from `wmts.geo.admin.ch`
- **Current**: Uses `maplibre-gl` with vector tiles from `vectortiles.geo.admin.ch`

### 2. **Vector Tile Source**
- **Style URL**: `https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json`
- **Style**: Light Base Map (ch.swisstopo.lightbasemap.vt) - clean, minimal cartography

### 3. **Key Features**
- Lightweight vector-based map rendering (smaller file sizes than raster tiles)
- Scalable to all zoom levels with smooth transitions
- Native support for map styling and customization
- Better performance on modern browsers

### 4. **Dependencies Added**
```json
{
  "maplibre-gl": "^4.7.0",
  "@types/maplibre-gl": "^9.20.2"
}
```

## Implementation Details

### Component Architecture

The `ConnectionMap` component now uses:

1. **MapLibre GL Instance**: Creates a map instance with Swiss Topo vector tiles as the base layer
2. **GeoJSON Layers**: Adds transit routes and walking paths as GeoJSON layers on top of the base map
3. **Custom Markers**: Uses MapLibre GL markers with DOM elements for departure/arrival/transfer stops
4. **Interactive Popups**: Each marker has a popup showing stop details (name, time, platform, delays)

### Map Interactions

- **Zoom Controls**: Native MapLibre GL zoom controls
- **Pan**: Drag to pan the map
- **Fit Bounds**: Automatically fits the map view to show all stops in the route
- **Marker Popups**: Click markers to view stop information

### Coordinate System

- **Input Coordinates**: Expects coordinates in the format `{lat, lng}`
- **MapLibre GL Format**: Converts to `[lng, lat]` (GeoJSON standard) internally

## File Structure

```
artifacts/sbb-connections/src/components/
├── ConnectionMap.tsx      # Main component with MapLibre GL integration
└── ConnectionMap.css      # MapLibre GL popup and marker styling
```

## Available Styles

The following Swiss Topo vector tile styles are available and can be used by changing the style URL:

- **Light Base Map** (default): `ch.swisstopo.lightbasemap.vt` - Clean, light design
- **Dark Base Map**: `ch.swisstopo.darkbasemap.vt` - Dark design for better contrast
- **Other variants**: Available through the Swiss Topo API

To switch styles, modify the `style` property in the `new maplibregl.Map()` constructor:

```typescript
style: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.darkbasemap.vt/style.json"
```

## Performance Benefits

1. **Smaller File Sizes**: Vector tiles are typically 5-10x smaller than raster tiles
2. **Smooth Transitions**: No tile boundaries visible when panning/zooming
3. **Fast Rendering**: GPU-accelerated vector rendering
4. **Better on Mobile**: Reduced bandwidth and CPU usage

## Swiss Topo API Reference

For more information about available datasets and styles, refer to:
- **Documentation**: https://docs.geo.admin.ch/visualize-data/vector-tiles.html
- **Available Datasets**: https://www.geo.admin.ch/en/vector-tiles-service-available-services-and-data

## Troubleshooting

### Map Not Rendering

1. Check browser console for errors
2. Verify MapLibre GL CSS is imported: `import "maplibre-gl/dist/maplibre-gl.css"`
3. Ensure the container div has a defined height

### Markers Not Appearing

- Verify coordinates are in correct format: `{lat, lng}`
- Check that MapLibre GL has finished loading before adding markers
- Use `map.on('load', ...)` to ensure readiness

### Styling Issues

- MapLibre GL popups are styled via CSS in `ConnectionMap.css`
- Tailwind classes in popup content may not work due to CSS-in-JS limitations
- Use inline styles or pre-defined CSS classes for popup styling

## Next Steps

Possible enhancements:
- Add toggle between different Swiss Topo styles (light/dark)
- Add layer controls to show/hide different data
- Add 3D terrain visualization using Swiss Topo elevation data
- Implement custom markers with images
- Add clustering for large datasets
