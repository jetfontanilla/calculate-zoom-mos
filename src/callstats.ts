import { ZoomQos } from "./zoom-qos";

class WebRtcCallStats {
    static readonly VIDEO_WIDTH = 640; // replace with actual client video resolution
    static readonly VIDEO_HEIGHT = 480;

    static readonly STATS_INTERVAL = 1000;
    static readonly STATS_MIN_VIDEO_BITRATE = 30000;
    static readonly STATS_LOCAL_AUDIO_DELAY = 20; //20 msecs: typical frame duration
    static readonly CONFIG_DEFAULT_AUDIO_BITRATE = 48000;

    static readonly JITTER_THRESHOLD = 30;
    static readonly RTT_THRESHOLD = 400;
    static readonly MOS_THRESHOLD = 3.5;
    static readonly PACKETLOSS_THRESHOLD = 1;

    static readonly MAX_RETRIES = 3;
    static readonly MAX_AUDIOLEVEL_COUNT = 20;


    /*
        http://www.itu.int/ITU-T/studygroups/com12/emodelv1/tut.htm
        formula for E model score
        R = Ro - Is - Id - Ie + A
        Ro = signal to noise ratio
        Is = signal impairments / distortion / noise
        Id = delay / echo
        Ie = packet loss / compression loss
        A = advantage factor (using wireless vs wired device)
        MOS = f(R) (R need to be converted into a meaningful MOS)
        MOS lower limit - rating
        4.34 - very satisfied
        4.03 - satisfied
        3.60 - some dissatisfied
        3.10 - many dissatisfied
        2.58 - nearly all dissastisfied
        R = 94.2 − Id − Ie
        94.2 is base score using default values for other factors
    */
    protected calculateAudioScore(zoomAudioQos: ZoomQos): number {
       
        let packetLoss = parseFloat(zoomAudioQos.avg_loss);

        let encodingImpairment = 0; // ILBC codec:10

        // λ1 and λ2 - constants that define the impact of packet loss to perceived quality
        let b = 19.8; // CELT/CELP based codec constants
        let c = 29.7;// CELT/CELP based codec constants

        let delayBudget = 177.3; // delay budget for VOIP streams, mouth to ear delay

        // compute Id
        let rtt = parseFloat(zoomAudioQos.latency); // check if this value is in secs or ms. this value should be in milliseconds
        let delay = rtt + WebRtcCallStats.STATS_LOCAL_AUDIO_DELAY;
        let delayNetworkFactor = (delay - delayBudget) < 0 ? 0 : delay - delayBudget;
        let delayCodec = 0.024 * delay;
        let delayNetwork = 0.11 * delayNetworkFactor;
        let Id = delayCodec + delayNetwork;

        // compute Ie
        // assumes Mono only
        let Ie = encodingImpairment + b * Math.log(1 + c * packetLoss);

        let score = 94.2 - Id - Ie;

        return this.computeAudioOpinionScore(score);
    }

    // return 1-5 score
    //For R < 0: MOS = 1
    //For 0 R 100: MOS = 1 + 0.035 R + 7.10E-6 R(R-60)(100-R)
    //For R > 100: MOS = 4.5
    protected computeAudioOpinionScore(score: number): number {
        if (score < 0) {
            return 1;
        }
        if (score > 100) {
            return 4.5;
        }
        return 1 + 0.035 * score + 7.10 / 1000000 * score * (score - 60) * (100 - score);
    }

    // Ro for video is simply the video bitrate compared to expected bitrate
    protected calculateVideoScore(zoomVideoQos: ZoomQos): number {
        let currentVideoBitRate = parseFloat(zoomVideoQos.bitrate);

        if (currentVideoBitRate < WebRtcCallStats.STATS_MIN_VIDEO_BITRATE) {
            return 0;
        }

        let targetBitRate = this.computeTargetBitRate();
        let bitRate = Math.min(currentVideoBitRate, targetBitRate);

        let score = (Math.log(bitRate / WebRtcCallStats.STATS_MIN_VIDEO_BITRATE)
            / Math.log(targetBitRate / WebRtcCallStats.STATS_MIN_VIDEO_BITRATE));

        return this.computeVideoOpinionScore(score);
    }

    // return 1-5 score
    protected computeVideoOpinionScore(score: number): number {
        return score * 4 + 1;
    }

    private computeTargetBitRate(): number {
        let pixelCount = WebRtcCallStats.VIDEO_WIDTH * WebRtcCallStats.VIDEO_HEIGHT;

        // power function maps resolution to target bitrate, based on rumor config
        // values, with r^2 = 0.98. We're ignoring frame rate, assume 30.
        let y = 2.069924867 * Math.pow(Math.log10(pixelCount), 0.6250223771);
        return Math.pow(10, y);
    }
}