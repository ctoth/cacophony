import { BaseSound } from "./cacophony";
import { FilterManager } from "./filters";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";
import { OscillatorMixin } from "./oscillatorMixin";

export class SynthPlayback extends OscillatorMixin(PannerMixin(VolumeMixin(FilterManager))) implements BaseSound {
}
