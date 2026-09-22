# PedalQuest 2.5D Parallax Background System — Claude Code Integration Spec

## Overview

Replace the 3D world rendering with a **2.5D parallax scrolling** system using 5 anime-style background layers for the **한강 (Han River)** map. Each layer scrolls horizontally at a different speed to create depth illusion.

## Asset Files

All assets in `/home/claude/hanriver_layers/`:

| Layer | File | Size | Format | Scroll Speed |
|-------|------|------|--------|-------------|
| 1 (Sky) | `layer1_sky.jpg` | 200KB | JPG (no alpha) | 0.02x |
| 2 (Far cityscape) | `layer2_far.png` | 1.7MB | PNG (gradient alpha top) | 0.15x |
| 3 (Mid river+bridge) | `layer3_mid.png` | 2.3MB | PNG (chroma keyed) | 0.4x |
| 4 (Near roadside) | `layer4_near.png` | 2.6MB | PNG (chroma keyed) | 0.7x |
| 5 (Road surface) | `layer5_road.jpg` | 578KB | JPG (no alpha) | 1.0x |

**Total: ~7.6MB** — all 1920×1080, seamlessly tileable horizontally.

Also include: `cyclist-spritesheet-new.png` (2664×6840, 73 frames, 8×10 grid, 333×684 each, 12fps) + `cyclist-sprite-meta-new.json`

## Copy to pedalquest project

```bash
# Background layers
mkdir -p pedalquest/static/maps/hanriver
cp hanriver_layers/layer1_sky.jpg pedalquest/static/maps/hanriver/
cp hanriver_layers/layer2_far.png pedalquest/static/maps/hanriver/
cp hanriver_layers/layer3_mid.png pedalquest/static/maps/hanriver/
cp hanriver_layers/layer4_near.png pedalquest/static/maps/hanriver/
cp hanriver_layers/layer5_road.jpg pedalquest/static/maps/hanriver/
cp hanriver_layers/hanriver-meta.json pedalquest/static/maps/hanriver/

# New cyclist sprite
cp cyclist-spritesheet-new.png pedalquest/static/
cp cyclist-sprite-meta-new.json pedalquest/static/
```

## Rendering Architecture

### Layer Stack (back to front)
```
┌─────────────────────────────────────────────┐
│  Layer 1: SKY (0.02x)                       │  ← Full screen backdrop
│  ┌─────────────────────────────────────────┐ │
│  │  Layer 2: FAR CITYSCAPE (0.15x)         │ │  ← Gradient alpha top → sky shows through
│  │  ┌─────────────────────────────────────┐│ │
│  │  │  Layer 3: MID RIVER+BRIDGE (0.4x)  │ │ │  ← Green-screen keyed → far+sky show through
│  │  │  ┌──────────────────────────────────┤ │ │
│  │  │  │  Layer 4: NEAR ROADSIDE (0.7x)  │ │ │  ← Green-screen keyed → mid+far+sky through
│  │  │  │  ┌───────────────────────────────┤ │ │
│  │  │  │  │  Layer 5: ROAD (1.0x)         │ │ │  ← Bottom strip only
│  │  │  │  │  ┌────────────────────────────┤ │ │
│  │  │  │  │  │  CHARACTER SPRITE          │ │ │  ← On top of road
│  │  │  │  │  │  COCKPIT OVERLAY           │ │ │  ← Arms/handlebar/speedometer
└──┴──┴──┴──┴──┴────────────────────────────┘─┘─┘
```

### Canvas Drawing Order
```javascript
// In the main render loop, replace 3D world rendering with:

function drawParallaxBackground(ctx, scrollOffset) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    
    // Each layer scrolls at its own speed
    const layers = [
        { img: skyImg,  speed: 0.02, y: 0, h: H },           // Full screen
        { img: farImg,  speed: 0.15, y: 0, h: H },           // Full screen (alpha gradient)
        { img: midImg,  speed: 0.4,  y: 0, h: H },           // Full screen (keyed)
        { img: nearImg, speed: 0.7,  y: 0, h: H },           // Full screen (keyed)
        { img: roadImg, speed: 1.0,  y: H * 0.72, h: H * 0.28 }, // Bottom 28%
    ];
    
    for (const layer of layers) {
        const offset = (scrollOffset * layer.speed) % layer.img.width;
        const sx = offset;
        
        // Draw twice for seamless wrapping
        ctx.drawImage(layer.img, 
            sx, 0, layer.img.width - sx, layer.img.height,
            0, layer.y, (layer.img.width - sx) * (layer.h / layer.img.height), layer.h
        );
        
        // Wrap-around portion
        if (sx > 0) {
            const remainW = W - (layer.img.width - sx) * (layer.h / layer.img.height);
            if (remainW > 0) {
                ctx.drawImage(layer.img,
                    0, 0, sx, layer.img.height,
                    W - remainW, layer.y, remainW, layer.h
                );
            }
        }
    }
}
```

### Scroll Speed Calculation
```javascript
// scrollOffset driven by game speed (from BLE sensor RPM)
// Each frame: scrollOffset += disp.speed * speedMultiplier * dt
// speedMultiplier tunes how fast the background moves per km/h

const SCROLL_PIXELS_PER_KMH = 8;  // Tune this for feel
scrollOffset += disp.speed * SCROLL_PIXELS_PER_KMH * (dt / 1000);
```

### Simplified Tile-Drawing Helper

Since each image is exactly 1920px wide (same as game width), tiling is straightforward:

```javascript
function drawTiledLayer(ctx, img, scrollX, destY, destH) {
    // scrollX is already modulo'd to img.width
    const x = -(scrollX % img.width);
    const scale = destH / img.height;
    const drawW = img.width * scale;
    
    // Draw enough copies to fill screen
    for (let dx = x; dx < ctx.canvas.width; dx += drawW) {
        ctx.drawImage(img, dx, destY, drawW, destH);
    }
}

// Usage in render:
drawTiledLayer(ctx, skyImg,  offset * 0.02,  0, H);
drawTiledLayer(ctx, farImg,  offset * 0.15,  0, H);
drawTiledLayer(ctx, midImg,  offset * 0.4,   0, H);
drawTiledLayer(ctx, nearImg, offset * 0.7,   0, H);
drawTiledLayer(ctx, roadImg, offset * 1.0,   H*0.72, H*0.28);
```

## Character Sprite Integration (New)

Replace old skirt character sprite with the new cyclist sprite:

```javascript
// Load new sprite
const cyclistSheet = new Image();
cyclistSheet.src = '/static/cyclist-spritesheet-new.png';

// Meta from cyclist-sprite-meta-new.json:
const CYCLIST = {
    frames: 73,
    cols: 8,
    rows: 10,
    frameWidth: 333,
    frameHeight: 684,
    fps: 12
};

// In render loop — draw cyclist on top of road, behind cockpit:
function drawCyclist(ctx, frameIndex) {
    const col = frameIndex % CYCLIST.cols;
    const row = Math.floor(frameIndex / CYCLIST.cols);
    const sx = col * CYCLIST.frameWidth;
    const sy = row * CYCLIST.frameHeight;
    
    // Position: centered horizontally, bottom aligned with road top
    const scale = 0.5;  // Adjust for proper size relative to screen
    const dw = CYCLIST.frameWidth * scale;
    const dh = CYCLIST.frameHeight * scale;
    const dx = (ctx.canvas.width - dw) / 2;
    const dy = ctx.canvas.height * 0.72 - dh;  // Sit on top of road layer
    
    ctx.drawImage(cyclistSheet,
        sx, sy, CYCLIST.frameWidth, CYCLIST.frameHeight,
        dx, dy, dw, dh
    );
}

// Frame advancement synced to pedal cadence:
// cyclistFrameTimer += dt;
// if (cyclistFrameTimer > 1000 / (CYCLIST.fps * (disp.speed / 20))) {
//     cyclistFrame = (cyclistFrame + 1) % CYCLIST.frames;
//     cyclistFrameTimer = 0;
// }
```

## Integration Points in game.html

1. **Image preloading**: Load all 5 layer images + sprite sheet at startup
2. **Replace 3D world**: In the render loop where `render3d.js` draws the 3D scene, replace with `drawParallaxBackground()`
3. **Drawing order**: Background layers → Cyclist sprite → Cockpit overlay (arms + speedometer)
4. **Scroll state**: Add `parallaxOffset` variable, increment each frame based on `disp.speed`
5. **Road layer positioning**: The road occupies bottom ~28% of screen — adjust cyclist and cockpit Y positions accordingly

## Performance Notes

- Sky + Road are JPG (no alpha blending needed) — fastest
- Far/Mid/Near are PNG with alpha — Canvas handles compositing via `drawImage()` natively
- Total texture memory: ~7.6MB uncompressed ≈ ~22MB decoded RGBA in GPU — well within RTX 2060 capacity
- For 60fps: 5 drawImage calls per frame is trivial
- Images are pre-sized to 1920×1080 — no runtime scaling needed (except road height crop)

## Map Data Structure (for future maps)

```javascript
const MAPS = {
    hanriver: {
        name: "한강 자전거길",
        layers: {
            sky:  { src: "/static/maps/hanriver/layer1_sky.jpg",  speed: 0.02 },
            far:  { src: "/static/maps/hanriver/layer2_far.png",  speed: 0.15 },
            mid:  { src: "/static/maps/hanriver/layer3_mid.png",  speed: 0.4  },
            near: { src: "/static/maps/hanriver/layer4_near.png", speed: 0.7  },
            road: { src: "/static/maps/hanriver/layer5_road.jpg", speed: 1.0  },
        },
        roadYRatio: 0.72,  // Road starts at 72% from top
    }
};
```
