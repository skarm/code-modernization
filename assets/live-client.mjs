// SPDX-License-Identifier: Apache-2.0
export class SSEParser {
  constructor(onEvent, limit = 16 * 1024 * 1024) { this.onEvent = onEvent; this.limit = limit; this.buffer = ''; this.decoder = new TextDecoder(); this.frame = []; this.size = 0; }
  push(bytes) {
    this.buffer += typeof bytes === 'string' ? bytes : this.decoder.decode(bytes, { stream: true });
    if (this.buffer.length > this.limit) throw new Error('Live event exceeds the client buffer');
    let end;
    while ((end = this.buffer.search(/[\r\n]/)) >= 0) {
      if (this.buffer[end] === '\r' && end === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, end), length = this.buffer[end] === '\r' && this.buffer[end + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(end + length);
      if (line) { this.frame.push(line); this.size += line.length; if (this.size > this.limit) throw new Error('Live event exceeds the client buffer'); continue; }
      const block = this.frame; this.frame = []; this.size = 0;
      let type = 'message', id; const data = [];
      for (const line of block) {
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') type = value;
        if (field === 'id' && !value.includes('\0')) id = value;
        if (field === 'data') data.push(value);
      }
      if (data.length) this.onEvent({ type, id, data: JSON.parse(data.join('\n')) });
    }
  }
}

export function applyUpdate(previous, event) {
  if (event.type === 'snapshot') {
    if (!event.data || typeof event.data.revision !== 'string') throw new Error('Invalid live snapshot');
    return event.data;
  }
  if (event.type !== 'patch') return previous;
  if (!previous || event.data?.base !== previous.revision || typeof event.data.revision !== 'string') throw new Error('Live revision gap; loading a fresh snapshot');
  return { ...previous, ...event.data.changes, revision: event.data.revision, readAtMs: event.data.readAtMs };
}

export class LiveConnection {
  constructor({ query, token, onModel, onHeartbeat = () => {}, onState = () => {}, fetcher = (...args) => fetch(...args) }) {
    Object.assign(this, { query, token, onModel, onHeartbeat, onState, fetcher }); this.generation = 0; this.model = null; this.lastId = ''; this.closed = true;
  }
  start() { this.stop(); this.closed = false; const generation = this.generation; this.loop(generation); }
  stop() { this.closed = true; this.generation++; this.stream?.abort(); this.read?.abort(); clearTimeout(this.retry); this.wakeRetry?.(); }
  restart() { this.model = null; this.lastId = ''; this.start(); }
  async refresh() {
    const generation = this.generation; this.read?.abort(); const controller = new AbortController(); this.read = controller;
    const response = await this.fetcher(`/api/model?${this.query()}`, { signal: controller.signal, cache: 'no-store', headers: { 'X-Modernization-Token': this.token() } });
    if (!response.ok) throw new Error((await response.json()).error || 'Snapshot request failed');
    const data = await response.json();
    if (generation !== this.generation || controller.signal.aborted) return;
    this.model = data; this.lastId = data.revision; this.onModel(data); return data;
  }
  async loop(generation) {
    let failures = 0;
    while (!this.closed && generation === this.generation) {
      const controller = new AbortController(); this.stream = controller;
      this.onState(failures ? 'reconnecting' : 'connecting'); let lastPacket = Date.now();
      const watchdog = setInterval(() => { if (Date.now() - lastPacket > 7000) controller.abort(); }, 1000);
      try {
        const response = await this.fetcher(`/api/events?${this.query()}`, { cache: 'no-store', signal: controller.signal,
          headers: { 'X-Modernization-Token': this.token(), ...(this.lastId ? { 'Last-Event-ID': this.lastId } : {}) } });
        if (!response.ok) throw new Error((await response.json()).error || `Live connection failed (${response.status})`);
        if (!response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Server did not return an event stream');
        const parser = new SSEParser(event => {
          if (generation !== this.generation || controller.signal.aborted) return;
          lastPacket = Date.now();
          if (event.type === 'fault') throw new Error(event.data.error || 'Live snapshot unavailable');
          if (event.type === 'heartbeat') this.onHeartbeat(event.data);
          else if (['snapshot', 'patch'].includes(event.type)) {
            try { this.model = applyUpdate(this.model, event); }
            catch (error) { this.lastId = ''; this.model = null; throw error; }
            this.lastId = event.id || this.model.revision; this.onModel(this.model);
          }
          failures = 0; this.onState('live');
        });
        const reader = response.body.getReader();
        try { while (true) { const { done, value } = await reader.read(); if (done) break; parser.push(value); } }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        throw new Error('Live stream closed');
      } catch (error) {
        if (this.closed || generation !== this.generation) break;
        failures++; this.onState('reconnecting', error);
        // A fresh snapshot also serves as a bounded fallback when streaming is unavailable.
        if (failures === 1 || failures % 3 === 0) {
          try { await this.refresh(); this.onState('polling'); } catch (e) { if (generation === this.generation) this.onState('offline', e); }
        }
      } finally { clearInterval(watchdog); controller.abort(); }
      if (this.closed || generation !== this.generation) break;
      await new Promise(resolve => { this.wakeRetry = resolve; this.retry = setTimeout(resolve, Math.min(5000, 250 * 2 ** Math.min(failures, 5))); }); this.wakeRetry = null;
    }
  }
}
