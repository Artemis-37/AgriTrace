// Démarre et arrête le serveur local : PostgreSQL embarqué + API AgriTrace (qui sert aussi le portail web).
// Aucun import d'Electron ici : le même code tourne sous Node pour les tests.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DB = 'agritrace';

class LocalServer {
  /**
   * @param {object} o
   * @param {string} o.dataDir       dossier des données (base, pièces jointes, secrets)
   * @param {string} o.appDir        dossier contenant backend/ (dist, migrations, scripts, node_modules) et web/ (build)
   * @param {number} [o.port=3000]   port du portail et de l'API (accessible depuis le réseau local)
   * @param {number} [o.pgPort=54329] port PostgreSQL (accessible uniquement depuis ce poste)
   * @param {string} [o.nodeBin]     exécutable Node (Electron lancé en mode Node, ou node)
   */
  constructor(o) {
    this.dataDir = o.dataDir; this.appDir = o.appDir;
    this.port = o.port ?? 3000; this.pgPort = o.pgPort ?? 54329;
    this.localOnly = !!o.localOnly;   // poste unique : l'API n'écoute que sur ce poste
    // Serveur du réseau local : HTTPS (certificat auto-signé épinglé par les postes) sur `port`, et HTTP réservé à ce poste sur port + 1.
    this.tls = !!o.tls && !this.localOnly;
    this.loopbackPort = this.tls ? this.port + 1 : this.port;
    this.fingerprint = null;
    this.nodeBin = o.nodeBin ?? process.execPath;
    this.log = o.log ?? (() => {});
    this.pg = null; this.api = null; this.state = 'stopped';
  }

  get url() { return `http://127.0.0.1:${this.loopbackPort}`; }
  get secretsFile() { return path.join(this.dataDir, 'server.json'); }

  /** Secrets générés au premier démarrage et conservés (jamais saisis par l'utilisateur). */
  secrets() {
    if (!this._secrets) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.existsSync(this.secretsFile)) this._secrets = JSON.parse(fs.readFileSync(this.secretsFile, 'utf8'));
      else {
        this._secrets = { ownerPassword: crypto.randomBytes(18).toString('base64url'), appPassword: crypto.randomBytes(18).toString('base64url'), jwtSecret: crypto.randomBytes(48).toString('base64url') };
        fs.writeFileSync(this.secretsFile, JSON.stringify(this._secrets), { mode: 0o600 });
      }
    }
    return this._secrets;
  }

  ownerUrl() { return `postgres://agritrace_owner:${encodeURIComponent(this.secrets().ownerPassword)}@127.0.0.1:${this.pgPort}/${DB}`; }
  appUrl() { return `postgres://agritrace_app:${encodeURIComponent(this.secrets().appPassword)}@127.0.0.1:${this.pgPort}/${DB}`; }

  async start() {
    if (this.state === 'running') return;
    this.state = 'starting';
    try {
      await this.startPostgres();
      await this.prepareDatabase();
      this.migrate();
      await this.startApi();
      this.state = 'running';
    } catch (e) {
      this.state = 'error';
      await this.stop().catch(() => undefined);
      this.state = 'error';
      throw e;
    }
  }

  async startPostgres() {
    // Module ESM : import dynamique (le Node d'Electron ne sait pas le charger par require).
    const mod = await import('embedded-postgres');
    const EmbeddedPostgres = mod.default ?? mod;
    const dir = path.join(this.dataDir, 'pgdata');
    const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
    this.pg = new EmbeddedPostgres({
      databaseDir: dir, user: 'agritrace_owner', password: this.secrets().ownerPassword, port: this.pgPort, persistent: true,
      // UTF8 obligatoire : sous Windows français, initdb choisit sinon WIN1252 et les migrations (flèches, guillemets…) échouent.
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=60', '-c', 'shared_buffers=128MB'],
      onLog: (m) => this.log('[pg] ' + String(m).trim()), onError: (m) => this.log('[pg!] ' + String(m).trim()),
    });
    if (fresh) await this.pg.initialise();
    await this.pg.start();
    if (fresh) await this.createDb();
    else await this.ensureUtf8();
  }

  async createDb() {
    const c = this.pg.getPgClient();
    await c.connect();
    try { await c.query(`CREATE DATABASE ${DB} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`); } finally { await c.end(); }
  }

  // Répare une base créée par une version antérieure dans un autre encodage (WIN1252) tant qu'elle ne contient aucune donnée.
  async ensureUtf8() {
    const admin = this.pg.getPgClient();
    await admin.connect();
    try {
      const r = await admin.query(`SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname=$1`, [DB]);
      if (!r.rowCount) { await admin.end(); return this.createDb(); }
      if (r.rows[0].enc === 'UTF8') return;
      const c = new Client({ connectionString: this.ownerUrl() });
      await c.connect();
      let rows = 0;
      try {
        const t = await c.query(`SELECT to_regclass('public.organizations') AS t`);
        if (t.rows[0].t) rows = (await c.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n;
      } finally { await c.end(); }
      if (rows > 0) throw new Error(`La base est encodée en ${r.rows[0].enc} et contient des données : exportez-les puis recréez-la en UTF8.`);
      this.log(`[pg] base vide en ${r.rows[0].enc} : recréation en UTF8`);
      await admin.query(`DROP DATABASE ${DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${DB} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    } finally { try { await admin.end(); } catch { /* déjà fermé */ } }
  }

  async prepareDatabase() {
    const c = new Client({ connectionString: this.ownerUrl() });
    await c.connect();
    try {
      const s = this.secrets();
      const has = await c.query(`SELECT 1 FROM pg_roles WHERE rolname='agritrace_app'`);
      if (!has.rowCount) await c.query(`CREATE ROLE agritrace_app LOGIN PASSWORD '${s.appPassword.replace(/'/g, "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      await c.query(`GRANT CONNECT ON DATABASE ${DB} TO agritrace_app; GRANT USAGE ON SCHEMA public TO agritrace_app;
        ALTER DEFAULT PRIVILEGES FOR ROLE agritrace_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agritrace_app;
        ALTER DEFAULT PRIVILEGES FOR ROLE agritrace_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agritrace_app;
        ALTER DEFAULT PRIVILEGES FOR ROLE agritrace_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO agritrace_app`);
    } finally { await c.end(); }
  }

  backendEnv(extra) {
    return { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', ...extra };
  }

  migrate() {
    const backend = path.join(this.appDir, 'backend');
    const r = spawnSync(this.nodeBin, [path.join(backend, 'scripts', 'migrate.js')], {
      cwd: backend, env: this.backendEnv({ DATABASE_URL: this.ownerUrl() }), encoding: 'utf8', windowsHide: true,
    });
    this.log(`[migrate] ${(r.stdout || '').trim()} ${(r.stderr || '').trim()}`);
    if (r.status !== 0) throw new Error('Mise à jour de la base impossible : ' + (r.stderr || r.stdout));
  }

  async startApi() {
    const backend = path.join(this.appDir, 'backend');
    const docs = path.join(this.dataDir, 'documents');
    fs.mkdirSync(docs, { recursive: true });
    this.api = spawn(this.nodeBin, [path.join(backend, 'dist', 'main.js')], {
      cwd: backend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: this.backendEnv({
        AGRITRACE_MODE: 'local', DATABASE_URL: this.appUrl(), JWT_SECRET: this.secrets().jwtSecret, PORT: String(this.port), ...(this.localOnly ? { HOST: '127.0.0.1' } : {}),
        ...(this.tls ? { TLS_DIR: path.join(this.dataDir, 'tls'), HTTP_LOOPBACK_PORT: String(this.loopbackPort) } : {}),
        DOCUMENTS_DIR: docs, WEB_DIR: path.join(this.appDir, 'web'), APP_VERSION: this.version ?? '0.1.0', THROTTLE_LIMIT: '600',
      }),
    });
    this.api.stdout.on('data', (d) => this.log('[api] ' + String(d).trim()));
    this.api.stderr.on('data', (d) => this.log('[api!] ' + String(d).trim()));
    let exited = null;
    this.api.on('exit', (code) => { exited = code; if (this.state === 'running') this.state = 'error'; });
    for (let i = 0; i < 120; i++) {
      if (exited !== null) throw new Error(`L'API s'est arrêtée au démarrage (code ${exited})`);
      try {
        if ((await fetch(`${this.url}/v1/ready`)).ok) {
          if (this.tls) this.fingerprint = (await (await fetch(`${this.url}/v1/mode`)).json()).tls_fingerprint ?? null;
          return;
        }
      } catch { /* pas encore prête */ }
      await sleep(500);
    }
    throw new Error("L'API ne répond pas");
  }

  async stop() {
    const api = this.api; this.api = null;
    if (api && api.exitCode === null) {
      api.kill();
      for (let i = 0; i < 20 && api.exitCode === null; i++) await sleep(250);
      if (api.exitCode === null) api.kill('SIGKILL');
    }
    if (this.pg) { try { await this.pg.stop(); } catch (e) { this.log('arrêt PostgreSQL : ' + e.message); } this.pg = null; }
    this.state = 'stopped';
  }

  /** Sauvegarde complète (base + pièces jointes) : le serveur est arrêté le temps de la copie, puis relancé. */
  async backup(targetRoot) {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const target = path.join(targetRoot, `AgriTrace-sauvegarde-${stamp}`);
    await this.stop();
    try {
      fs.mkdirSync(target, { recursive: true });
      for (const part of ['pgdata', 'documents', 'server.json', 'tls']) {
        const from = path.join(this.dataDir, part);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(target, part), { recursive: true });
      }
    } finally { await this.start(); }
    return target;
  }

  /** Restaure une sauvegarde (dossier « AgriTrace-sauvegarde-… ») : le serveur s'arrête, les données actuelles sont mises de côté (jamais effacées), puis le serveur redémarre. */
  async restore(sourceDir) {
    if (!fs.existsSync(path.join(sourceDir, 'pgdata'))) throw new Error('Ce dossier n\'est pas une sauvegarde AgriTrace (dossier « pgdata » absent).');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const aside = path.join(this.dataDir, '..', `server-avant-restauration-${stamp}`);
    await this.stop();
    try {
      fs.mkdirSync(aside, { recursive: true });
      for (const part of ['pgdata', 'documents', 'server.json', 'tls']) {
        const cur = path.join(this.dataDir, part);
        if (fs.existsSync(cur)) fs.renameSync(cur, path.join(aside, part));
        const from = path.join(sourceDir, part);
        if (fs.existsSync(from)) fs.cpSync(from, cur, { recursive: true });
      }
    } finally { await this.start(); }
    return aside;
  }
}

module.exports = { LocalServer };
