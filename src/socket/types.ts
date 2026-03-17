// src/socket/types.ts
import type { JwtUserPayload } from '../types/auth';

export interface Participant {
  socketId: string;
  userId: string;
  name: string;
  role: 'teacher' | 'student';
  isMuted: boolean;
  isCameraOff: boolean;
  hasHandRaised: boolean;
  isAdmitted?: boolean;
  roomId: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  message: string;
  timestamp: string;
}

export interface RoomMeta {
  title: string;
  teacherId: string;
  status: 'waiting' | 'live' | 'ended';
  createdAt: string;
  isRecording?: 'true' | 'false';
}

export interface ClientToServerEvents {
  'join-room': (payload: { roomId: string; role: 'teacher' | 'student' }) => void;
  offer: (payload: { to: string; sdp: RTCSessionDescriptionInit }) => void;
  answer: (payload: { to: string; sdp: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (payload: { to: string; candidate: RTCIceCandidateInit }) => void;
  'hand-raise': (payload: { raised: boolean }) => void;
  'send-chat': (payload: { message: string }) => void;
  'admit-student': (payload: { socketId: string }) => void;
  'mute-participant': (payload: { targetId: string }) => void;
  'leave-room': (payload: {}) => void;
  'end-session': (payload: { roomId: string }) => void;
  'get-rtp-capabilities': (
    payload: { roomId: string },
    callback: (response: { rtpCapabilities: unknown } | { error: string }) => void,
  ) => void;
  'create-transport': (
    payload: { roomId: string },
    callback: (
      response:
        | {
            id: string;
            iceParameters: unknown;
            iceCandidates: unknown[];
            dtlsParameters: unknown;
          }
        | { error: string },
    ) => void,
  ) => void;
  'connect-transport': (
    payload: {
      roomId: string;
      transportId: string;
      dtlsParameters: unknown;
    },
    callback: (response: { ok: true } | { error: string }) => void,
  ) => void;
  produce: (
    payload: {
      roomId: string;
      transportId: string;
      kind: 'audio' | 'video';
      rtpParameters: unknown;
    },
    callback: (response: { producerId: string } | { error: string }) => void,
  ) => void;
  consume: (
    payload: {
      roomId: string;
      transportId: string;
      producerId: string;
      rtpCapabilities: unknown;
    },
    callback: (
      response:
        | {
            id: string;
            producerId: string;
            kind: string;
            rtpParameters: unknown;
          }
        | { error: string },
    ) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'peer-joined': (payload: { socketId: string; name: string; role: string }) => void;
  'participant-list': (payload: { participants: Participant[] }) => void;
  offer: (payload: { from: string; sdp: RTCSessionDescriptionInit }) => void;
  answer: (payload: { from: string; sdp: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (payload: { from: string; candidate: RTCIceCandidateInit }) => void;
  'hand-raised': (payload: { socketId: string; name: string; raised: boolean }) => void;
  'chat-message': (payload: {
    senderId: string;
    senderName: string;
    message: string;
    timestamp: string;
  }) => void;
  'force-mute': () => void;
  admitted: () => void;
  'session-ended': () => void;
  error: (payload: { code: string; message: string }) => void;
}

export interface SocketData {
  user: JwtUserPayload;
  roomId?: string;
}

