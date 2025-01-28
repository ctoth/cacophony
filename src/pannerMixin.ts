import type { PanType, Position } from "./cacophony";
import type { AudioContext, PannerNode, StereoPannerNode } from "./context";
import { FilterManager } from "./filters";

export type PanCloneOverrides = {
    panType?: PanType;
    stereoPan?: number; // -1 (left) to 1 (right)
    threeDOptions?: Partial<PannerOptions>; // HRTF panning only
    position?: Position; // HRTF panning only, [x, y, z]
};

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

export function PannerMixin<TBase extends Constructor>(Base: TBase) {
    abstract class PannerMixin extends Base {
        panner?: PannerNode | StereoPannerNode;
        _panType: PanType = 'stereo';

        get panType(): PanType {
            return this._panType;
        }

        setPanType(panType: PanType, audioContext: AudioContext) {
            if (this._panType === panType && this.panner) {
                // If the pan type is already set and a panner exists, do nothing
                return;
            }

            // Clean up existing panner if it exists
            if (this.panner) {
                this.panner.disconnect();
            }

            this._panType = panType;
            if (panType === 'stereo') {
                this.panner = audioContext.createStereoPanner();
            } else {
                this.panner = audioContext.createPanner();
            }
        }

        setPannerNode(pannerNode: PannerNode) {
            this.panner = pannerNode;
        }

        /**
        * Gets the stereo panning value.
        * @returns {number | null} The current stereo pan value, or null if stereo panning is not applicable.
        * @throws {Error} Throws an error if stereo panning is not available or if the sound has been cleaned up.
        */

        get stereoPan(): number | null {
            if (this.panType === 'stereo') {
                return (this.panner as StereoPannerNode).pan.value;
            }
            return null;
        }

        /**
        * Sets the stereo panning value.
        * @param {number} value - The stereo pan value to set, between -1 (left) and 1 (right).
        * @throws {Error} Throws an error if stereo panning is not available, if the sound has been cleaned up, or if the value is out of bounds.
        */

        set stereoPan(value: number) {
            if (this.panType !== 'stereo') {
                throw new Error('Stereo panning is not available when using HRTF.');
            }
            if (!this.panner) {
                throw new Error('Cannot set stereo pan of a sound that has been cleaned up');
            }
            value = clamp(value, -1, 1);
            (this.panner as StereoPannerNode).pan.setValueAtTime(clamp(value, -1, 1), this.panner.context.currentTime);
        }


        /**
        * Gets the 3D audio options if HRTF panning is used.
        * @returns {IPannerOptions} The current 3D audio options.
        * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
        */

        get threeDOptions(): PannerOptions {
            if (!this.panner) {
                throw new Error('Cannot get 3D options of a sound that has been cleaned up');
            }
            if (this.panType !== 'HRTF') {
                throw new Error('Cannot get 3D options of a sound that is not using HRTF');
            }
            const panner = this.panner as PannerNode;
            return {
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
                positionX: panner.positionX.value,
                positionY: panner.positionY.value,
                positionZ: panner.positionZ.value,
                orientationX: panner.orientationX.value,
                orientationY: panner.orientationY.value,
                orientationZ: panner.orientationZ.value
            }
        }

        /**
     * Sets the 3D audio options for HRTF panning.
     * @param {Partial<IPannerOptions>} options - The 3D audio options to set.
     * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
     */
        set threeDOptions(options: Partial<PannerOptions>) {
            if (!this.panner) {
                throw new Error('Cannot set 3D options of a sound that has been cleaned up');
            }
            if (this.panType !== 'HRTF') {
                throw new Error('Cannot set 3D options of a sound that is not using HRTF');
            }
            const panner = this.panner as PannerNode;
            panner.coneInnerAngle = options.coneInnerAngle !== undefined ? options.coneInnerAngle : panner.coneInnerAngle;
            panner.coneOuterAngle = options.coneOuterAngle !== undefined ? options.coneOuterAngle : panner.coneOuterAngle;
            panner.coneOuterGain = options.coneOuterGain !== undefined ? options.coneOuterGain : panner.coneOuterGain;
            panner.distanceModel = options.distanceModel || panner.distanceModel;
            panner.maxDistance = options.maxDistance !== undefined ? options.maxDistance : panner.maxDistance;
            panner.channelCount = options.channelCount !== undefined ? options.channelCount : panner.channelCount;
            panner.channelCountMode = options.channelCountMode || panner.channelCountMode;
            panner.channelInterpretation = options.channelInterpretation || panner.channelInterpretation;
            panner.panningModel = options.panningModel || panner.panningModel;
            panner.refDistance = options.refDistance !== undefined ? options.refDistance : panner.refDistance;
            panner.rolloffFactor = options.rolloffFactor !== undefined ? options.rolloffFactor : panner.rolloffFactor;
            panner.positionX.value = options.positionX !== undefined ? options.positionX : panner.positionX.value;
            panner.positionY.value = options.positionY !== undefined ? options.positionY : panner.positionY.value;
            panner.positionZ.value = options.positionZ !== undefined ? options.positionZ : panner.positionZ.value;
            panner.orientationX.value = options.orientationX !== undefined ? options.orientationX : panner.orientationX.value;
            panner.orientationY.value = options.orientationY !== undefined ? options.orientationY : panner.orientationY.value;
            panner.orientationZ.value = options.orientationZ !== undefined ? options.orientationZ : panner.orientationZ.value;
        }


        /**
        * Sets the position of the audio source in 3D space (HRTF panning only).
        * @param {Position} position - The [x, y, z] coordinates of the audio source.
        * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
        */

        set position(position: Position) {
            if (!this.panner) {
                throw new Error('Cannot move a sound that has been cleaned up');
            }
            if (this.panType !== 'HRTF') {
                throw new Error('Cannot move a sound that is not using HRTF');
            }
            const [x, y, z] = position;
            const panner = this.panner as PannerNode;
            panner.positionX.value = x;
            panner.positionY.value = y;
            panner.positionZ.value = z;
        }

        /**
        * Gets the position of the audio source in 3D space (HRTF panning only).
        * @returns {Position} The [x, y, z] coordinates of the audio source.
        * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
        */

        get position(): Position {
            if (!this.panner) {
                throw new Error('Cannot get position of a sound that has been cleaned up');
            }
            if (this.panType !== 'HRTF') {
                throw new Error('Cannot get position of a sound that is not using HRTF');
            }
            const panner = this.panner as PannerNode;
            return [panner.positionX.value, panner.positionY.value, panner.positionZ.value];
        }


    }

    return PannerMixin;
}


function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
