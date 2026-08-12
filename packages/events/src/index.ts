import { EventEmitter } from 'node:events';

export interface DomainEvent<T = unknown> {
  name: string;
  payload: T;
  timestamp: Date;
}

class EventBus {
  private emitter = new EventEmitter();

  emit<T = unknown>(eventName: string, payload: T): void {
    const event: DomainEvent<T> = {
      name: eventName,
      payload,
      timestamp: new Date(),
    };
    this.emitter.emit(eventName, event);
  }

  on<T = unknown>(eventName: string, listener: (event: DomainEvent<T>) => void): void {
    this.emitter.on(eventName, listener);
  }
}

export const domainEvents = new EventBus();
export * from './event-map';
export * from './event-envelope';
export * from './outbox-repository';
export * from './event-writer';
export * from './outbox-dispatcher';
