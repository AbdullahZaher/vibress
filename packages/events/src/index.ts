import { EventEmitter } from 'node:events';

export interface DomainEvent<T = any> {
  name: string;
  payload: T;
  timestamp: Date;
}

class EventBus {
  private emitter = new EventEmitter();

  emit<T = any>(eventName: string, payload: T): void {
    const event: DomainEvent<T> = {
      name: eventName,
      payload,
      timestamp: new Date(),
    };
    this.emitter.emit(eventName, event);
  }

  on<T = any>(eventName: string, listener: (event: DomainEvent<T>) => void): void {
    this.emitter.on(eventName, listener);
  }
}

export const domainEvents = new EventBus();
