import v8 from 'node:v8';
import fs from 'node:fs';

export class MemProbe {
  constructor(label) {
    this.label = label;
    this.samples = [];
  }

  sample(tag) {
    if (global.gc) global.gc();   // Requires --expose-gc
    const m = process.memoryUsage();
    this.samples.push({
      tag,
      heapMB: m.heapUsed / 1024 / 1024,
      extMB: m.external / 1024 / 1024,
      abMB: m.arrayBuffers / 1024 / 1024,
      t: performance.now(),
    });
  }

  snapshot(tag) {
    // Writes a .heapsnapshot file — open in Chrome DevTools → Memory tab
    // to see retained object graphs. This is how you find WHAT is leaking.
    const file = `heap_${this.label}_${tag}_${Date.now()}.heapsnapshot`;
    v8.writeHeapSnapshot(file);
    console.log(`Heap snapshot: ${file}`);
  }

  report() {
    console.table(this.samples.map(s => ({
      tag: s.tag,
      'heap (MB)': s.heapMB.toFixed(1),
      'external (MB)': s.extMB.toFixed(1),
      'ArrayBuffers (MB)': s.abMB.toFixed(1),
    })));

    if (this.samples.length >= 2) {
      const growth = this.samples.at(-1).heapMB - this.samples[0].heapMB;
      console.log(`\nNet heap growth: ${growth >= 0 ? '+' : ''}${growth.toFixed(1)} MB`);
    }
  }
}