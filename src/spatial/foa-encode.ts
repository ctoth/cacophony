/**
 * Positional first-order ambisonic (FOA) encoder — SN3D normalization, ACN
 * channel ordering (i.e. the AmbiX convention).
 *
 * Encodes a single mono sample placed at a direction (azimuth, elevation) into
 * the four first-order spherical-harmonic channels `[W, Y, Z, X]` (ACN indices
 * 0,1,2,3). This is the physically-correct, normalized counterpart to the
 * perceptual `StereoToFoaUpmixer`, and is the clean way to drive
 * {@link import('../effects').FoaDecoder}: encode a mono source to FOA,
 * then decode that FOA to binaural.
 *
 * Convention (LOCKED by reports/scout-b2-decode-decision.md, Decision 4):
 *  - SN3D (semi-normalized): the order-0 harmonic Y_0^0 = 1 and the order-1
 *    SN3D harmonics have unit peak gain — NO sqrt(3) factor (that is N3D).
 *  - ACN ordering `[W, Y, Z, X]` = (n,m) = (0,0),(1,-1),(1,0),(1,+1).
 *  - Right-handed coordinate frame: +x forward, +y left, +z up (Ahrens 2022,
 *    "Binaural Audio Rendering in the Spherical Harmonic Domain", p.7).
 *
 * Closed form (azimuth `theta` counter-clockwise from front so +theta steers
 * left; elevation `phi` positive up):
 *
 *   W = s
 *   Y = s * cos(phi) * sin(theta)
 *   Z = s * sin(phi)
 *   X = s * cos(phi) * cos(theta)
 *
 * Source: ambiX — Nachbar, Zotter, Deleflie & Sontacchi 2011, "ambiX - A
 * Suggested Ambisonics Format"; and Zotter & Frank 2019, "Ambisonics: A
 * Practical 3D Audio Theory" (Springer). The first-order SN3D/ACN encode gains
 * `W=1, Y=cos(phi)sin(theta), Z=sin(phi), X=cos(phi)cos(theta)`.
 *
 * @param sample      Mono input sample `s`.
 * @param azimuthRad  Azimuth `theta` in radians, CCW from front (+ = left).
 * @param elevationRad Elevation `phi` in radians (+ = up).
 * @returns the four FOA channels in ACN order: `[W, Y, Z, X]`.
 */
export function encodeMonoToFoaSN3D(
  sample: number,
  azimuthRad: number,
  elevationRad: number,
): [w: number, y: number, z: number, x: number] {
  const cosEl = Math.cos(elevationRad);
  const w = sample;
  const y = sample * cosEl * Math.sin(azimuthRad);
  const z = sample * Math.sin(elevationRad);
  const x = sample * cosEl * Math.cos(azimuthRad);
  return [w, y, z, x];
}
