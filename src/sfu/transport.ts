// src/sfu/transport.ts
import type { Router, WebRtcTransport } from 'mediasoup/node/lib/types';

import { config } from '../config';

export interface WebRtcTransportParams {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown[];
  dtlsParameters: unknown;
}

export const createWebRtcTransport = async (
  router: Router,
): Promise<{ transport: WebRtcTransport; params: WebRtcTransportParams }> => {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: config.MEDIASOUP_LISTEN_IP,
        announcedIp: config.MEDIASOUP_ANNOUNCED_IP,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates as unknown[],
      dtlsParameters: transport.dtlsParameters,
    },
  };
};

