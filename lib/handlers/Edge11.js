"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const Logger_1 = require("../Logger");
const errors_1 = require("../errors");
const utils = __importStar(require("../utils"));
const ortc = __importStar(require("../ortc"));
const edgeUtils = __importStar(require("./ortc/edgeUtils"));
const HandlerInterface_1 = require("./HandlerInterface");
const logger = new Logger_1.Logger('Edge11');
class Edge11 extends HandlerInterface_1.HandlerInterface {
    constructor() {
        super();
        // Map of RTCRtpSenders indexed by id.
        this._rtpSenders = new Map();
        // Map of RTCRtpReceivers indexed by id.
        this._rtpReceivers = new Map();
        // Next localId for sending tracks.
        this._nextSendLocalId = 0;
        // Got transport local and remote parameters.
        this._transportReady = false;
    }
    /**
     * Creates a factory function.
     */
    static createFactory() {
        return () => new Edge11();
    }
    get name() {
        return 'Edge11';
    }
    close() {
        logger.debug('close()');
        // Close the ICE gatherer.
        // NOTE: Not yet implemented by Edge.
        try {
            this._iceGatherer.close();
        }
        catch (error) { }
        // Close the ICE transport.
        try {
            this._iceTransport.stop();
        }
        catch (error) { }
        // Close the DTLS transport.
        try {
            this._dtlsTransport.stop();
        }
        catch (error) { }
        // Close RTCRtpSenders.
        for (const rtpSender of this._rtpSenders.values()) {
            try {
                rtpSender.stop();
            }
            catch (error) { }
        }
        // Close RTCRtpReceivers.
        for (const rtpReceiver of this._rtpReceivers.values()) {
            try {
                rtpReceiver.stop();
            }
            catch (error) { }
        }
    }
    getNativeRtpCapabilities() {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('getNativeRtpCapabilities()');
            return edgeUtils.getCapabilities();
        });
    }
    getNativeSctpCapabilities() {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('getNativeSctpCapabilities()');
            return {
                numStreams: { OS: 0, MIS: 0 }
            };
        });
    }
    run({ direction, // eslint-disable-line @typescript-eslint/no-unused-vars
    iceParameters, iceCandidates, dtlsParameters, sctpParameters, // eslint-disable-line @typescript-eslint/no-unused-vars
    iceServers, iceTransportPolicy, additionalSettings, // eslint-disable-line @typescript-eslint/no-unused-vars
    proprietaryConstraints, // eslint-disable-line @typescript-eslint/no-unused-vars
    extendedRtpCapabilities }) {
        logger.debug('run()');
        this._sendingRtpParametersByKind =
            {
                audio: ortc.getSendingRtpParameters('audio', extendedRtpCapabilities),
                video: ortc.getSendingRtpParameters('video', extendedRtpCapabilities)
            };
        this._remoteIceParameters = iceParameters;
        this._remoteIceCandidates = iceCandidates;
        this._remoteDtlsParameters = dtlsParameters;
        this._cname = `CNAME-${utils.generateRandomNumber()}`;
        this._setIceGatherer({ iceServers, iceTransportPolicy });
        this._setIceTransport();
        this._setDtlsTransport();
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    updateIceServers(iceServers) {
        return __awaiter(this, void 0, void 0, function* () {
            // NOTE: Edge 11 does not implement iceGatherer.gater().
            throw new errors_1.UnsupportedError('not supported');
        });
    }
    restartIce(iceParameters) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('restartIce()');
            this._remoteIceParameters = iceParameters;
            if (!this._transportReady)
                return;
            logger.debug('restartIce() | calling iceTransport.start()');
            this._iceTransport.start(this._iceGatherer, iceParameters, 'controlling');
            for (const candidate of this._remoteIceCandidates) {
                this._iceTransport.addRemoteCandidate(candidate);
            }
            this._iceTransport.addRemoteCandidate({});
        });
    }
    getTransportStats() {
        return __awaiter(this, void 0, void 0, function* () {
            return this._iceTransport.getStats();
        });
    }
    send(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    { track, encodings, codecOptions, codec }) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('send() [kind:%s, track.id:%s]', track.kind, track.id);
            if (!this._transportReady)
                yield this._setupTransport({ localDtlsRole: 'server' });
            logger.debug('send() | calling new RTCRtpSender()');
            const rtpSender = new RTCRtpSender(track, this._dtlsTransport);
            const rtpParameters = utils.clone(this._sendingRtpParametersByKind[track.kind]);
            rtpParameters.codecs = ortc.reduceCodecs(rtpParameters.codecs, codec);
            const useRtx = rtpParameters.codecs
                .some((_codec) => /.+\/rtx$/i.test(_codec.mimeType));
            if (!encodings)
                encodings = [{}];
            for (const encoding of encodings) {
                encoding.ssrc = utils.generateRandomNumber();
                if (useRtx)
                    encoding.rtx = { ssrc: utils.generateRandomNumber() };
            }
            rtpParameters.encodings = encodings;
            // Fill RTCRtpParameters.rtcp.
            rtpParameters.rtcp =
                {
                    cname: this._cname,
                    reducedSize: true,
                    mux: true
                };
            // NOTE: Convert our standard RTCRtpParameters into those that Edge
            // expects.
            const edgeRtpParameters = edgeUtils.mangleRtpParameters(rtpParameters);
            logger.debug('send() | calling rtpSender.send() [params:%o]', edgeRtpParameters);
            yield rtpSender.send(edgeRtpParameters);
            const localId = String(this._nextSendLocalId);
            this._nextSendLocalId++;
            // Store it.
            this._rtpSenders.set(localId, rtpSender);
            return { localId, rtpParameters, rtpSender };
        });
    }
    stopSending(localId) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('stopSending() [localId:%s]', localId);
            const rtpSender = this._rtpSenders.get(localId);
            if (!rtpSender)
                throw new Error('RTCRtpSender not found');
            this._rtpSenders.delete(localId);
            try {
                logger.debug('stopSending() | calling rtpSender.stop()');
                rtpSender.stop();
            }
            catch (error) {
                logger.warn('stopSending() | rtpSender.stop() failed:%o', error);
                throw error;
            }
        });
    }
    replaceTrack(localId, track) {
        return __awaiter(this, void 0, void 0, function* () {
            if (track) {
                logger.debug('replaceTrack() [localId:%s, track.id:%s]', localId, track.id);
            }
            else {
                logger.debug('replaceTrack() [localId:%s, no track]', localId);
            }
            const rtpSender = this._rtpSenders.get(localId);
            if (!rtpSender)
                throw new Error('RTCRtpSender not found');
            rtpSender.setTrack(track);
        });
    }
    setMaxSpatialLayer(localId, spatialLayer) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('setMaxSpatialLayer() [localId:%s, spatialLayer:%s]', localId, spatialLayer);
            const rtpSender = this._rtpSenders.get(localId);
            if (!rtpSender)
                throw new Error('RTCRtpSender not found');
            const parameters = rtpSender.getParameters();
            parameters.encodings
                .forEach((encoding, idx) => {
                if (idx <= spatialLayer)
                    encoding.active = true;
                else
                    encoding.active = false;
            });
            yield rtpSender.setParameters(parameters);
        });
    }
    setRtpEncodingParameters(localId, params) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('setRtpEncodingParameters() [localId:%s, params:%o]', localId, params);
            const rtpSender = this._rtpSenders.get(localId);
            if (!rtpSender)
                throw new Error('RTCRtpSender not found');
            const parameters = rtpSender.getParameters();
            parameters.encodings.forEach((encoding, idx) => {
                parameters.encodings[idx] = Object.assign(Object.assign({}, encoding), params);
            });
            yield rtpSender.setParameters(parameters);
        });
    }
    getSenderStats(localId) {
        return __awaiter(this, void 0, void 0, function* () {
            const rtpSender = this._rtpSenders.get(localId);
            if (!rtpSender)
                throw new Error('RTCRtpSender not found');
            return rtpSender.getStats();
        });
    }
    sendDataChannel(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options) {
        return __awaiter(this, void 0, void 0, function* () {
            throw new errors_1.UnsupportedError('not implemented');
        });
    }
    receive({ trackId, kind, rtpParameters }) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('receive() [trackId:%s, kind:%s]', trackId, kind);
            if (!this._transportReady)
                yield this._setupTransport({ localDtlsRole: 'server' });
            logger.debug('receive() | calling new RTCRtpReceiver()');
            const rtpReceiver = new RTCRtpReceiver(this._dtlsTransport, kind);
            rtpReceiver.addEventListener('error', (event) => {
                logger.error('rtpReceiver "error" event [event:%o]', event);
            });
            // NOTE: Convert our standard RTCRtpParameters into those that Edge
            // expects.
            const edgeRtpParameters = edgeUtils.mangleRtpParameters(rtpParameters);
            logger.debug('receive() | calling rtpReceiver.receive() [params:%o]', edgeRtpParameters);
            yield rtpReceiver.receive(edgeRtpParameters);
            const localId = trackId;
            // Store it.
            this._rtpReceivers.set(localId, rtpReceiver);
            return {
                localId,
                track: rtpReceiver.track,
                rtpReceiver
            };
        });
    }
    stopReceiving(localId) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('stopReceiving() [localId:%s]', localId);
            const rtpReceiver = this._rtpReceivers.get(localId);
            if (!rtpReceiver)
                throw new Error('RTCRtpReceiver not found');
            this._rtpReceivers.delete(localId);
            try {
                logger.debug('stopReceiving() | calling rtpReceiver.stop()');
                rtpReceiver.stop();
            }
            catch (error) {
                logger.warn('stopReceiving() | rtpReceiver.stop() failed:%o', error);
            }
        });
    }
    getReceiverStats(localId) {
        return __awaiter(this, void 0, void 0, function* () {
            const rtpReceiver = this._rtpReceivers.get(localId);
            if (!rtpReceiver)
                throw new Error('RTCRtpReceiver not found');
            return rtpReceiver.getStats();
        });
    }
    receiveDataChannel(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options) {
        return __awaiter(this, void 0, void 0, function* () {
            throw new errors_1.UnsupportedError('not implemented');
        });
    }
    _setIceGatherer({ iceServers, iceTransportPolicy }) {
        const iceGatherer = new RTCIceGatherer({
            iceServers: iceServers || [],
            gatherPolicy: iceTransportPolicy || 'all'
        });
        iceGatherer.addEventListener('error', (event) => {
            logger.error('iceGatherer "error" event [event:%o]', event);
        });
        // NOTE: Not yet implemented by Edge, which starts gathering automatically.
        try {
            iceGatherer.gather();
        }
        catch (error) {
            logger.debug('_setIceGatherer() | iceGatherer.gather() failed: %s', error.toString());
        }
        this._iceGatherer = iceGatherer;
    }
    _setIceTransport() {
        const iceTransport = new RTCIceTransport(this._iceGatherer);
        // NOTE: Not yet implemented by Edge.
        iceTransport.addEventListener('statechange', () => {
            switch (iceTransport.state) {
                case 'checking':
                    this.emit('@connectionstatechange', 'connecting');
                    break;
                case 'connected':
                case 'completed':
                    this.emit('@connectionstatechange', 'connected');
                    break;
                case 'failed':
                    this.emit('@connectionstatechange', 'failed');
                    break;
                case 'disconnected':
                    this.emit('@connectionstatechange', 'disconnected');
                    break;
                case 'closed':
                    this.emit('@connectionstatechange', 'closed');
                    break;
            }
        });
        // NOTE: Not standard, but implemented by Edge.
        iceTransport.addEventListener('icestatechange', () => {
            switch (iceTransport.state) {
                case 'checking':
                    this.emit('@connectionstatechange', 'connecting');
                    break;
                case 'connected':
                case 'completed':
                    this.emit('@connectionstatechange', 'connected');
                    break;
                case 'failed':
                    this.emit('@connectionstatechange', 'failed');
                    break;
                case 'disconnected':
                    this.emit('@connectionstatechange', 'disconnected');
                    break;
                case 'closed':
                    this.emit('@connectionstatechange', 'closed');
                    break;
            }
        });
        iceTransport.addEventListener('candidatepairchange', (event) => {
            logger.debug('iceTransport "candidatepairchange" event [pair:%o]', event.pair);
        });
        this._iceTransport = iceTransport;
    }
    _setDtlsTransport() {
        const dtlsTransport = new RTCDtlsTransport(this._iceTransport);
        // NOTE: Not yet implemented by Edge.
        dtlsTransport.addEventListener('statechange', () => {
            logger.debug('dtlsTransport "statechange" event [state:%s]', dtlsTransport.state);
        });
        // NOTE: Not standard, but implemented by Edge.
        dtlsTransport.addEventListener('dtlsstatechange', () => {
            logger.debug('dtlsTransport "dtlsstatechange" event [state:%s]', dtlsTransport.state);
            if (dtlsTransport.state === 'closed')
                this.emit('@connectionstatechange', 'closed');
        });
        dtlsTransport.addEventListener('error', (event) => {
            logger.error('dtlsTransport "error" event [event:%o]', event);
        });
        this._dtlsTransport = dtlsTransport;
    }
    _setupTransport({ localDtlsRole }) {
        return __awaiter(this, void 0, void 0, function* () {
            logger.debug('_setupTransport()');
            // Get our local DTLS parameters.
            const dtlsParameters = this._dtlsTransport.getLocalParameters();
            dtlsParameters.role = localDtlsRole;
            // Need to tell the remote transport about our parameters.
            yield this.safeEmitAsPromise('@connect', { dtlsParameters });
            // Start the RTCIceTransport.
            this._iceTransport.start(this._iceGatherer, this._remoteIceParameters, 'controlling');
            // Add remote ICE candidates.
            for (const candidate of this._remoteIceCandidates) {
                this._iceTransport.addRemoteCandidate(candidate);
            }
            // Also signal a 'complete' candidate as per spec.
            // NOTE: It should be {complete: true} but Edge prefers {}.
            // NOTE: If we don't signal end of candidates, the Edge RTCIceTransport
            // won't enter the 'completed' state.
            this._iceTransport.addRemoteCandidate({});
            // NOTE: Edge does not like SHA less than 256.
            this._remoteDtlsParameters.fingerprints = this._remoteDtlsParameters.fingerprints
                .filter((fingerprint) => {
                return (fingerprint.algorithm === 'sha-256' ||
                    fingerprint.algorithm === 'sha-384' ||
                    fingerprint.algorithm === 'sha-512');
            });
            // Start the RTCDtlsTransport.
            this._dtlsTransport.start(this._remoteDtlsParameters);
            this._transportReady = true;
        });
    }
}
exports.Edge11 = Edge11;
