/**
 * sim-firestore.mjs — in-memory stand-in for Firestore + FCM, shared by
 * reminder-equivalence.mjs and ledger-test.mjs.
 *
 * NOTHING HERE TOUCHES THE NETWORK. There is no firebase-admin import, no
 * credential, no URL. The real project's Firestore holds one cancer patient's
 * medication history; the harnesses must never be able to reach it even by
 * accident, so the fake is a plain Map and the module under test receives it
 * by injection.
 *
 * Implements only the surface send-reminders.js actually uses:
 *   collection(name).get()
 *   collection(name).where(field, '==', value).get()
 *   collection(name).doc(id).get() / .create(data) / .delete()
 *
 * create() reproduces the behaviour the ledger depends on: it rejects with
 * gRPC code 6 (ALREADY_EXISTS) when the document is already there.
 */

export class AlreadyExistsError extends Error {
  constructor(path) {
    super('Document already exists: ' + path);
    this.code = 6;
  }
}

function snapshot(entries) {
  const docs = entries.map(([id, data]) => ({ id, data: () => data, exists: true }));
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (fn) => docs.forEach(fn)
  };
}

export class SimFirestore {
  constructor(opts = {}) {
    // collection name -> Map(docId -> data)
    this.data = new Map();
    // Failure injection, all default-off.
    this.failCollections = new Set(opts.failCollections || []);
    this.writeLog = [];
    this.readCount = 0;
  }

  _col(name) {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name);
  }

  /** Test-side seeding; bypasses the injectable failures on purpose. */
  seed(collection, id, data) {
    this._col(collection).set(id, data);
  }

  docIds(collection) {
    return [...this._col(collection).keys()].sort();
  }

  all(collection) {
    return [...this._col(collection).entries()].map(([id, d]) => ({ id, ...d }));
  }

  collection(name) {
    const self = this;
    const guard = () => {
      if (self.failCollections.has(name)) {
        throw new Error('SIMULATED Firestore failure reading ' + name);
      }
    };
    const makeQuery = (filters) => ({
      where(field, op, value) {
        if (op !== '==') throw new Error('sim supports only "==" (got ' + op + ')');
        return makeQuery(filters.concat([[field, value]]));
      },
      async get() {
        guard();
        self.readCount++;
        const out = [];
        for (const [id, data] of self._col(name)) {
          if (filters.every(([f, v]) => data[f] === v)) out.push([id, data]);
        }
        return snapshot(out);
      }
    });

    return {
      where: (f, op, v) => makeQuery([]).where(f, op, v),
      get: () => makeQuery([]).get(),
      doc(id) {
        const path = name + '/' + id;
        return {
          async get() {
            guard();
            const m = self._col(name);
            const has = m.has(id);
            return { exists: has, id, data: () => m.get(id) };
          },
          async create(data) {
            guard();
            const m = self._col(name);
            if (m.has(id)) throw new AlreadyExistsError(path);
            m.set(id, data);
            self.writeLog.push({ op: 'create', path, data });
            return { writeTime: Date.now() };
          },
          async set() {
            throw new Error('set() is forbidden: the ledger is append-only (' + path + ')');
          },
          async update() {
            throw new Error('update() is forbidden: the ledger is append-only (' + path + ')');
          },
          async delete() {
            self._col(name).delete(id);
            self.writeLog.push({ op: 'delete', path });
          }
        };
      }
    };
  }
}

/** FCM stand-in. Records every outbound message; can be made to fail. */
export class SimMessaging {
  constructor(opts = {}) {
    this.sentMessages = [];
    this.failMode = opts.failMode || null; // null | 'throw' | 'unregistered'
  }
  async send(message) {
    if (this.failMode === 'throw') {
      throw new Error('SIMULATED FCM transport failure');
    }
    if (this.failMode === 'unregistered') {
      const err = new Error('token not registered');
      err.code = 'messaging/registration-token-not-registered';
      throw err;
    }
    this.sentMessages.push(message);
    return 'sim-message-id-' + this.sentMessages.length;
  }
}

/** A Date subclass whose zero-arg constructor and now() are pinned to `nowMs`. */
export function frozenDateClass(nowMs) {
  return class FrozenDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }
    static now() { return nowMs; }
  };
}

/** Discards log lines; harnesses assert on behaviour, not on chatter. */
export const quietLog = () => {};
