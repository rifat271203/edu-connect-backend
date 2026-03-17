// src/services/recording.service.ts
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Router } from 'mediasoup/node/lib/types';

import { config, redis } from '../config';

const activeRecordings = new Map<string, ChildProcess>();

export const startRecording = async (roomId: string, router: Router): Promise<void> => {
  if (activeRecordings.has(roomId)) {
    return;
  }

  await fs.mkdir(config.OUTPUT_DIR, { recursive: true });

  const plainTransport = await router.createPlainTransport({
    listenIp: { ip: config.MEDIASOUP_LISTEN_IP, announcedIp: config.MEDIASOUP_ANNOUNCED_IP },
    rtcpMux: false,
    comedia: false,
  });

  const sdpPath = path.join(config.OUTPUT_DIR, `${roomId}-${Date.now()}.sdp`);
  const outputPath = path.join(config.OUTPUT_DIR, `${roomId}-${Date.now()}.webm`);

  const sdpContent = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=Mediasoup Recording',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    'm=audio 40000 RTP/AVP 111',
    'a=rtpmap:111 opus/48000/2',
    '',
  ].join('\n');

  await fs.writeFile(sdpPath, sdpContent, 'utf-8');

  const ffmpeg = spawn('ffmpeg', [
    '-protocol_whitelist',
    'file,pipe,rtp,rtsp,udp',
    '-i',
    sdpPath,
    '-c',
    'copy',
    outputPath,
  ]);

  ffmpeg.on('exit', () => {
    activeRecordings.delete(roomId);
    plainTransport.close();
  });

  activeRecordings.set(roomId, ffmpeg);
  await redis.hset(`room:${roomId}:meta`, { isRecording: 'true' });
};

export const stopRecording = async (roomId: string): Promise<{ fileUrl: string } | null> => {
  const process = activeRecordings.get(roomId);

  if (!process) {
    return null;
  }

  process.kill('SIGINT');
  activeRecordings.delete(roomId);

  await redis.hset(`room:${roomId}:meta`, { isRecording: 'false' });

  return {
    fileUrl: path.join(config.OUTPUT_DIR, `${roomId}-${Date.now()}.webm`),
  };
};

