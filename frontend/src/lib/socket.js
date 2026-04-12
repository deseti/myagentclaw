'use client';

import { useEffect, useRef, useState } from 'react';
import { io as ioClient } from 'socket.io-client';
import { getToken } from './auth';

let socketInstance = null;

export function getSocket() {
  if (typeof window === 'undefined') return null;
  if (!socketInstance) {
    const configuredWsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
    const wsUrl = configuredWsUrl || window.location.origin;
    socketInstance = ioClient(wsUrl, {
      path: '/ws/',
      auth: { token: getToken() },
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });
  }
  return socketInstance;
}

export function connectSocket() {
  const socket = getSocket();
  if (socket && !socket.connected) {
    socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  if (socketInstance?.connected) {
    socketInstance.disconnect();
  }
  socketInstance = null;
}

/**
 * React hook untuk subscribe Socket.io events.
 * Auto-connect saat component mount, auto-cleanup saat unmount.
 *
 * @param {Record<string, Function>} eventHandlers - Map event -> callback
 * @returns {{ connected: boolean, socket: import('socket.io-client').Socket|null }}
 */
export function useSocket(eventHandlers = {}) {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(eventHandlers);
  handlersRef.current = eventHandlers;

  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Register event handlers
    const events = Object.keys(handlersRef.current);
    const wrappedHandlers = {};
    for (const event of events) {
      wrappedHandlers[event] = (...args) => handlersRef.current[event]?.(...args);
      socket.on(event, wrappedHandlers[event]);
    }

    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const event of events) {
        socket.off(event, wrappedHandlers[event]);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { connected, socket: getSocket() };
}
