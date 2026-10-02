import type { PanType, Position } from "./cacophony";
import type { AudioParam, BaseContext, PannerNode, StereoPannerNode } from "./context";
import type { FilterManager } from "./filters";
import { type SpatialOptions, validateSpatialOptions } from "./playOptions";
import { SpatialAutomation, validateSpatialSmoothingTau } from "./spatialAutomation";

/**
 * The HRTF-relevant subset of {@link PannerOptions}. Derived via `Pick` so the
 * set of fields tracks the lib.dom definition rather than being re-listed.
 */
export type HrtfPannerOptions = Pick<
  PannerOptions,
  | "coneInnerAngle"
  | "coneOuterAngle"
  | "coneOuterGain"
  | "distanceModel"
  | "maxDistance"
  | "channelCount"
  | "channelCountMode"
  | "channelInterpretation"
  | "panningModel"
  | "refDistance"
  | "rolloffFactor"
  | "positionX"
  | "positionY"
  | "positionZ"
  | "orientationX"
  | "orientationY"
  | "orientationZ"
>;

/**
 * Fully populated HRTF configuration. Panning mode is selected by the source or
 * voice; assigning these options configures that mode without switching it.
 * Partial overrides use {@link HrtfPannerOptions}.
 */
export type ThreeDOptions = { panType: "HRTF"; position?: Position } & Required<HrtfPannerOptions>;

export type PanCloneOverrides = {
  spatialSmoothingTau?: number;
  panType?: PanType;
  stereoPan?: number; // -1 (left) to 1 (right)
  threeDOptions?: Partial<HrtfPannerOptions>; // HRTF panning only
  position?: Position; // HRTF panning only, [x, y, z]
};

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

/** Structural contract of the spatial mixin, keeping private state out of declaration inference. */
export interface PannerControls {
  panner?: PannerNode | StereoPannerNode;
  _panType: PanType;
  readonly panType: PanType;
  /** Spatial exponential time constant in seconds (default 0). Setting 0 snaps pending targets. */
  spatialSmoothingTau: number;
  /** @internal Whether spatial writes should transition instead of initialize a voice. */
  readonly _spatialSmoothingActive: boolean;
  /** @internal Snap pending spatial transitions to their requested targets. */
  _snapSpatialMotion(): void;
  /** @internal Validate a spatial write without changing the voice. */
  _validateSpatialOptions(options: SpatialOptions): void;
  setPanType(panType: PanType, audioContext: BaseContext): void;
  setPannerNode(pannerNode: PannerNode): void;
  /** Requested stereo pan target, including during smoothing. */
  get stereoPan(): number | null;
  set stereoPan(value: number);
  /** Panner configuration with requested position/orientation targets; omitted axes retain automation. */
  get threeDOptions(): ThreeDOptions;
  set threeDOptions(options: ThreeDOptions | Partial<HrtfPannerOptions>);
  /** Requested position target; initial poses are immediate, subsequent writes use spatialSmoothingTau. */
  position: Position;
  cleanup(): void;
}

type PannerMixinConstructor<TBase extends Constructor> = TBase & (abstract new (...args: any[]) => PannerControls);

export function PannerMixin<TBase extends Constructor>(Base: TBase): PannerMixinConstructor<TBase>;
export function PannerMixin<TBase extends Constructor>(Base: TBase) {
  abstract class PannerMixin extends Base {
    panner?: PannerNode | StereoPannerNode;
    _panType: PanType = "stereo";
    private _spatialSmoothingTau = 0;
    private readonly spatialAutomation = new SpatialAutomation();

    /**
     * Exponential time constant in seconds for position, orientation and stereo pan.
     * Defaults to 0 (immediate). Changing it retargets active transitions continuously;
     * setting 0 snaps them to their requested targets. Initial voice settings stay immediate.
     * @throws RangeError for negative or non-finite values.
     */
    get spatialSmoothingTau(): number {
      return this._spatialSmoothingTau;
    }

    set spatialSmoothingTau(tau: number) {
      validateSpatialSmoothingTau(tau);
      this.spatialAutomation.reconfigure(tau, this.panner?.context.currentTime ?? 0);
      this._spatialSmoothingTau = tau;
    }

    /** @internal */
    get _spatialSmoothingActive(): boolean {
      return true;
    }

    /** @internal */
    _snapSpatialMotion(): void {
      if (this.panner) this.spatialAutomation.reconfigure(0, this.panner.context.currentTime);
    }

    private writeSpatialParam(param: AudioParam, value: number, scheduled = false): void {
      this.spatialAutomation.write(
        param,
        value,
        this.panner!.context.currentTime,
        this._spatialSmoothingActive ? this.spatialSmoothingTau : 0,
        scheduled,
      );
    }

    get panType(): PanType {
      return this._panType;
    }

    /** @internal */
    _validateSpatialOptions(options: SpatialOptions): void {
      validateSpatialOptions(options, this.panType);
      if (!this.panner) {
        throw new Error("Cannot set spatial controls of a sound that has been cleaned up");
      }
    }

    setPanType(panType: PanType, audioContext: BaseContext) {
      if (this._panType === panType && this.panner) {
        // If the pan type is already set and a panner exists, do nothing
        return;
      }

      // Clean up existing panner if it exists
      this.spatialAutomation.clear();
      if (this.panner) {
        this.panner.disconnect();
      }

      this._panType = panType;
      if (panType === "stereo") {
        this.panner = audioContext.createStereoPanner();
      } else {
        this.panner = audioContext.createPanner();
      }
    }

    setPannerNode(pannerNode: PannerNode) {
      this.spatialAutomation.clear();
      this.panner = pannerNode;
    }

    /**
     * Gets the requested stereo panning target, including during smoothing.
     * @returns {number | null} The stereo pan target, or null if stereo panning is not applicable.
     */

    get stereoPan(): number | null {
      if (this.panType === "stereo") {
        return this.spatialAutomation.target((this.panner as StereoPannerNode).pan);
      }
      return null;
    }

    /**
     * Sets the stereo panning value.
     * Uses spatialSmoothingTau after initial voice configuration.
     * @param {number} value - The stereo pan value to set, between -1 (left) and 1 (right).
     * @throws {Error} Throws an error if stereo panning is not available, if the sound has been cleaned up, or if the value is out of bounds.
     */

    set stereoPan(value: number) {
      this._validateSpatialOptions({ stereoPan: value });
      this.writeSpatialParam((this.panner as StereoPannerNode).pan, value, true);
    }

    /**
     * Gets the 3D audio options if HRTF panning is used, with requested spatial targets.
     * @returns {ThreeDOptions} The current 3D audio options (HRTF variant).
     * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
     */

    get threeDOptions(): ThreeDOptions {
      if (!this.panner) {
        throw new Error("Cannot get 3D options of a sound that has been cleaned up");
      }
      if (this.panType !== "HRTF") {
        throw new Error("Cannot get 3D options of a sound that is not using HRTF");
      }
      const panner = this.panner as PannerNode;
      return {
        panType: "HRTF",
        coneInnerAngle: panner.coneInnerAngle,
        coneOuterAngle: panner.coneOuterAngle,
        coneOuterGain: panner.coneOuterGain,
        distanceModel: panner.distanceModel,
        maxDistance: panner.maxDistance,
        channelCount: this.panner.channelCount,
        channelCountMode: panner.channelCountMode,
        channelInterpretation: panner.channelInterpretation,
        panningModel: panner.panningModel,
        refDistance: panner.refDistance,
        rolloffFactor: panner.rolloffFactor,
        positionX: this.spatialAutomation.target(panner.positionX),
        positionY: this.spatialAutomation.target(panner.positionY),
        positionZ: this.spatialAutomation.target(panner.positionZ),
        orientationX: this.spatialAutomation.target(panner.orientationX),
        orientationY: this.spatialAutomation.target(panner.orientationY),
        orientationZ: this.spatialAutomation.target(panner.orientationZ),
      };
    }

    /**
     * Sets the 3D audio options for HRTF panning.
     * Accepts either a full {@link ThreeDOptions} value or a partial HRTF override.
     * Any field omitted from the input is left at its current value on the underlying PannerNode.
     * Position and orientation changes use spatialSmoothingTau; omitted axes keep their automation.
     * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
     */
    set threeDOptions(options: ThreeDOptions | Partial<HrtfPannerOptions>) {
      this._validateSpatialOptions({ threeDOptions: options });
      const panner = this.panner as PannerNode;
      panner.coneInnerAngle = options.coneInnerAngle !== undefined ? options.coneInnerAngle : panner.coneInnerAngle;
      panner.coneOuterAngle = options.coneOuterAngle !== undefined ? options.coneOuterAngle : panner.coneOuterAngle;
      panner.coneOuterGain = options.coneOuterGain !== undefined ? options.coneOuterGain : panner.coneOuterGain;
      panner.distanceModel = options.distanceModel ?? panner.distanceModel;
      panner.maxDistance = options.maxDistance !== undefined ? options.maxDistance : panner.maxDistance;
      panner.channelCount = options.channelCount !== undefined ? options.channelCount : panner.channelCount;
      panner.channelCountMode = options.channelCountMode ?? panner.channelCountMode;
      panner.channelInterpretation = options.channelInterpretation ?? panner.channelInterpretation;
      panner.panningModel = options.panningModel ?? panner.panningModel;
      panner.refDistance = options.refDistance !== undefined ? options.refDistance : panner.refDistance;
      panner.rolloffFactor = options.rolloffFactor !== undefined ? options.rolloffFactor : panner.rolloffFactor;
      for (const key of [
        "positionX",
        "positionY",
        "positionZ",
        "orientationX",
        "orientationY",
        "orientationZ",
      ] as const) {
        const value = options[key];
        if (value !== undefined) this.writeSpatialParam(panner[key], value);
      }
      if ("position" in options && options.position !== undefined) this.position = options.position;
    }

    /**
     * Sets the position of the audio source in 3D space (HRTF panning only).
     * Uses spatialSmoothingTau after initial voice configuration.
     * @param {Position} position - The [x, y, z] coordinates of the audio source.
     * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
     */

    set position(position: Position) {
      this._validateSpatialOptions({ position });
      const [x, y, z] = position;
      const panner = this.panner as PannerNode;
      this.writeSpatialParam(panner.positionX, x);
      this.writeSpatialParam(panner.positionY, y);
      this.writeSpatialParam(panner.positionZ, z);
    }

    /**
     * Gets the requested position target in 3D space, including during smoothing (HRTF only).
     * @returns {Position} The [x, y, z] coordinates of the audio source.
     * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
     */

    get position(): Position {
      if (!this.panner) {
        throw new Error("Cannot get position of a sound that has been cleaned up");
      }
      if (this.panType !== "HRTF") {
        throw new Error("Cannot get position of a sound that is not using HRTF");
      }
      const panner = this.panner as PannerNode;
      return [panner.positionX, panner.positionY, panner.positionZ].map((param) =>
        this.spatialAutomation.target(param),
      ) as Position;
    }

    cleanup(): void {
      this.spatialAutomation.clear();
      if (this.panner) {
        this.panner.disconnect();
        this.panner = undefined;
      }
      super.cleanup();
    }
  }

  return PannerMixin;
}
