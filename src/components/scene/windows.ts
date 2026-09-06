/**
 * Windows, as a patch to a standard material rather than as geometry.
 *
 * One home for "what a window looks like", used by both the student's building
 * and the neighbourhood around it, so a glazed tower and a glazed office block
 * are drawn by the same code and read as the same thing.
 *
 * Why a shader and not boxes: a twelve-storey tower at 30% glazing is roughly
 * six hundred panes, and the same again for every neighbour on the block. As
 * geometry that is tens of thousands of faces to shadow and sort, for
 * something that is four rectangles of arithmetic per pixel. It is also the
 * only version that costs nothing to change — the window-to-wall ratio is a
 * uniform, so dragging the facade control re-draws every pane on the building
 * without touching the scene graph.
 *
 * WHAT IS SET OUT, AND WHY IT LOOKS DESIGNED. Panes are laid out on a bay
 * derived from the *face they are on*: the number of bays across a face is the
 * face width divided by the target bay, rounded, and the bay is then the face
 * width divided by that count. So every face gets whole panes, edge to edge,
 * on both the long and the short elevation of the same box — which is what a
 * real elevation does, and the thing a fixed metre grid gets visibly wrong at
 * the corners.
 *
 * A pane fills `sqrt(ratio)` of its bay in each direction, so the fraction of
 * wall it *covers* is the window-to-wall ratio the engine was given. That is
 * the whole point of doing it this way: the ratio on screen and the ratio in
 * `FACADE` are the same number, so a curtain wall looks like a curtain wall
 * and a punched facade looks punched, without anyone tuning it by eye.
 *
 * The pattern is deterministic — a hash of the bay index decides which panes
 * are lit after dark — for the same reason `scenery.ts` is seeded: a building
 * whose windows reshuffled every frame would be a building nobody trusted.
 */

import { MeshStandardMaterial, type MeshStandardMaterialParameters } from 'three'
import { SURFACE_CODE, type SurfacePattern } from '@/lib/materialLook.ts'

export interface WindowPatternOptions {
  /**
   * True when the material goes on an `InstancedMesh` of unit boxes, where
   * the real size lives in `instanceMatrix`. False when the geometry is
   * already the right size, as the storey boxes are.
   */
  instanced: boolean
  /** Target bay: roughly how wide and how tall one window bay wants to be. */
  bayWidth_m: number
  bayHeight_m: number
  /** Fraction of panes lit after dark, dimensionless 0..1. */
  litFraction: number
}

export interface WindowedMaterial {
  readonly material: MeshStandardMaterial
  /** Glazed fraction of the wall, 0..1. Sets pane *size*, not pane count. */
  setWindowToWallRatio: (ratio: number) => void
  /** How far into the night it is, 0..1. Lights the panes. */
  setNight: (night: number) => void
  /**
   * Wall colour and how strongly it glows, together, because they are always
   * set together. A setter rather than a handle on the material, so callers
   * mutate through this module rather than reaching into it.
   */
  setAppearance: (color: string, emissiveIntensity: number) => void
  /** Size of the box, for the non-instanced case. Metres. */
  setSize: (x: number, y: number, z: number) => void
  /**
   * The material's finish: sheen, and the set-out drawn across the wall. See
   * `lib/materialLook.ts` for why this is deliberately not a colour.
   */
  setFinish: (finish: {
    roughness: number
    metalness: number
    surface: SurfacePattern
    relief: number
  }) => void
  dispose: () => void
}

const VERTEX_COMMON = /* glsl */ `
  varying vec3 vWinPos;
  varying vec3 vWinNormal;
  varying vec3 vWinSize;
`

const FRAGMENT_COMMON = /* glsl */ `
  uniform float uWindowRatio;
  uniform float uNight;
  uniform float uLitFraction;
  uniform vec2 uBay;
  uniform float uSurface;
  uniform float uRelief;
  varying vec3 vWinPos;
  varying vec3 vWinNormal;
  varying vec3 vWinSize;

  // Cheap, stable per-bay noise. Only ever decides whether a light is on.
  float winHash(vec2 bay) {
    vec2 p = fract(bay * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Distance to the nearest gridline, widened by the pixel's own footprint.
  // Without the fwidth term a 0.26 m brick course on a block 300 m away is
  // finer than a pixel and turns into moire; with it, the coursing simply
  // fades out at the distance it would stop being visible anyway.
  float winRule(float coord, float pitch, float width) {
    float d = abs(fract(coord / pitch + 0.5) - 0.5) * pitch;
    return 1.0 - smoothstep(0.0, max(width, fwidth(coord) * 0.9), d);
  }

  // The set-out for one wall, in metres across the face. Pitches are real
  // building dimensions -- a 0.26 m brick bed, a 3 m cast panel -- so the
  // pattern scales with the building rather than with the screen.
  float winSurfacePattern(vec2 wall) {
    if (uSurface < 0.5) {
      return max(winRule(wall.x, 3.0, 0.02), winRule(wall.y, 3.0, 0.02));
    } else if (uSurface < 1.5) {
      return winRule(wall.x, 1.6, 0.03);
    } else if (uSurface < 2.5) {
      return winRule(wall.x, 0.28, 0.008);
    } else if (uSurface < 3.5) {
      return winRule(wall.x, 0.16, 0.01);
    } else if (uSurface < 4.5) {
      return winRule(wall.y, 0.45, 0.022);
    } else if (uSurface < 5.5) {
      float row = floor(wall.y / 0.26);
      float stagger = mod(row, 2.0) * 0.24;
      return max(
        winRule(wall.y, 0.26, 0.012),
        winRule(wall.x + stagger, 0.48, 0.01)
      );
    }
    return winRule(wall.x, 0.34, 0.014);
  }
`

/** Daylight glass: a cool darkening of whatever the wall colour is. */
const GLASS_TINT = 'vec3(0.42, 0.48, 0.58)'
/** Warm interior light, after dark. */
const LIT_COLOUR = 'vec3(1.0, 0.78, 0.45)'

export function createWindowedMaterial(
  parameters: MeshStandardMaterialParameters,
  options: WindowPatternOptions,
): WindowedMaterial {
  const uniforms = {
    uWindowRatio: { value: 0 },
    uNight: { value: 0 },
    uLitFraction: { value: options.litFraction },
    uBay: { value: [options.bayWidth_m, options.bayHeight_m] as [number, number] },
    uSize: { value: [1, 1, 1] as [number, number, number] },
    // -1 until a finish is set, which the shader reads as "draw no set-out".
    // A default of 0 would silently give every unfinished wall cast-concrete
    // panel joints, which is a lie that looks like a decision.
    uSurface: { value: -1 },
    uRelief: { value: 0 },
  }

  const material = new MeshStandardMaterial(parameters)

  material.onBeforeCompile = (shader) => {
    shader.uniforms['uWindowRatio'] = uniforms.uWindowRatio
    shader.uniforms['uNight'] = uniforms.uNight
    shader.uniforms['uLitFraction'] = uniforms.uLitFraction
    shader.uniforms['uBay'] = uniforms.uBay
    shader.uniforms['uSize'] = uniforms.uSize
    shader.uniforms['uSurface'] = uniforms.uSurface
    shader.uniforms['uRelief'] = uniforms.uRelief

    // Where the box's real size comes from is the only difference between the
    // two callers: an instanced unit box carries it in its matrix, a sized
    // geometry has it baked into the vertices and is told it as a uniform.
    const sizeSnippet = options.instanced
      ? `vWinSize = vec3(
           length(instanceMatrix[0].xyz),
           length(instanceMatrix[1].xyz),
           length(instanceMatrix[2].xyz)
         );
         vWinPos = position * vWinSize;`
      : `vWinSize = uSize;
         vWinPos = position;`

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_COMMON}\nuniform vec3 uSize;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         ${sizeSnippet}
         vWinNormal = normal;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_COMMON}`)
      // Declared here, used again in the emissive block below. Both injections
      // land in the same scope of main(), so the values carry across.
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float winPane = 0.0;
         float winLit = 0.0;
         float winSurf = 0.0;
         {
           vec3 winFace = abs(vWinNormal);
           // Roofs and soffits get neither windows nor a wall set-out.
           if (winFace.y < 0.5) {
             // Which two of the box's dimensions this face spans, and where
             // on it we are. Both run -size/2 .. +size/2.
             vec2 winFaceSize = winFace.x > 0.5
               ? vec2(vWinSize.z, vWinSize.y)
               : vec2(vWinSize.x, vWinSize.y);
             vec2 winWall = winFace.x > 0.5 ? vWinPos.zy : vWinPos.xy;

             // The set-out is a property of the wall, not of its glazing, so
             // it is drawn on a blank elevation too.
             if (uRelief > 0.001) winSurf = winSurfacePattern(winWall);

             if (uWindowRatio > 0.001) {
               // Whole bays, edge to edge, on this face specifically.
               vec2 winCount = max(vec2(1.0), floor(winFaceSize / uBay + 0.5));
               vec2 winGrid = (winWall + winFaceSize * 0.5) / (winFaceSize / winCount);
               vec2 winBay = floor(winGrid);

               // Half-width of the pane within its bay. sqrt, so that the AREA
               // it covers is uWindowRatio.
               float winHalf = 0.5 * sqrt(clamp(uWindowRatio, 0.0, 1.0));
               vec2 winOffset = abs(fract(winGrid) - 0.5);
               winPane = step(winOffset.x, winHalf) * step(winOffset.y, winHalf);
               winLit = step(winHash(winBay), uLitFraction);
             }
           }
         }
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${GLASS_TINT}, winPane);
         // Joints darken the solid wall only: a pane is glass, and glass has
         // no coursing. Multiplying keeps this a shading of whatever colour
         // the storey already is, so the utilisation band survives intact.
         diffuseColor.rgb *= 1.0 - uRelief * winSurf * (1.0 - winPane);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance +=
           ${LIT_COLOUR} * winPane * winLit * uNight * 1.8;`,
      )
  }

  return {
    material,
    setWindowToWallRatio(ratio) {
      uniforms.uWindowRatio.value = ratio
    },
    setNight(night) {
      uniforms.uNight.value = night
    },
    setAppearance(color, emissiveIntensity) {
      material.color.set(color)
      material.emissive.set(color)
      material.emissiveIntensity = emissiveIntensity
    },
    setSize(x, y, z) {
      uniforms.uSize.value[0] = x
      uniforms.uSize.value[1] = y
      uniforms.uSize.value[2] = z
    },
    setFinish({ roughness, metalness, surface, relief }) {
      material.roughness = roughness
      material.metalness = metalness
      uniforms.uSurface.value = SURFACE_CODE[surface]
      uniforms.uRelief.value = relief
    },
    dispose() {
      material.dispose()
    },
  }
}
