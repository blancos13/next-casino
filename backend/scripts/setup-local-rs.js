/* eslint-disable no-console */
const fs = require("fs");
const { execSync } = require("child_process");
const { MongoClient } = require("mongodb");

const uri = "mongodb://127.0.0.1:27017/?directConnection=true";
const rsConfig = {
  _id: "rs0",
  members: [{ _id: 0, host: "localhost:27017" }],
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isConnectionError = (message) =>
  /Server selection timed out|ECONNREFUSED|connect ECONNREFUSED|Topology is closed|timed out after/i.test(
    message || "",
  );

const runCmd = (cmd) => execSync(cmd, { stdio: "pipe", encoding: "utf8" }).trim();

function parseConfigFromServicePath(servicePathName) {
  if (!servicePathName) return null;
  const configMatch = servicePathName.match(/--config\s+("?)([^"\s]+)\1/i);
  if (configMatch && configMatch[2]) return configMatch[2];
  const shortMatch = servicePathName.match(/-f\s+("?)([^"\s]+)\1/i);
  if (shortMatch && shortMatch[2]) return shortMatch[2];
  return null;
}

function guessMongoConfigPath() {
  if (process.env.MONGOD_CONFIG && fs.existsSync(process.env.MONGOD_CONFIG)) {
    return process.env.MONGOD_CONFIG;
  }

  try {
    const servicePath = runCmd(
      `powershell -NoProfile -Command "$svc = Get-CimInstance Win32_Service | Where-Object { $_.Name -match 'MongoDB' } | Select-Object -First 1; if ($svc) { $svc.PathName }"`,
    );
    const parsed = parseConfigFromServicePath(servicePath);
    if (parsed && fs.existsSync(parsed)) {
      return parsed;
    }
  } catch (_) {
    // ignore
  }

  const candidates = [
    "C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\8.2\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\8.0\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\7.0\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\6.0\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\5.0\\bin\\mongod.cfg",
    "C:\\Program Files\\MongoDB\\Server\\5.0\\mongod.cfg",
    "C:\\MongoDB\\mongod.cfg",
  ];
  return candidates.find((item) => fs.existsSync(item)) || null;
}

function ensureReplicaSetInConfig(cfgPath) {
  const raw = fs.readFileSync(cfgPath, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);

  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*replSetName\s*:/.test(lines[i])) {
      if (!/^\s*replSetName\s*:\s*rs0\s*$/.test(lines[i])) {
        lines[i] = lines[i].replace(/^\s*replSetName\s*:.*/, "  replSetName: rs0");
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(cfgPath, lines.join(eol), "utf8");
      }
      return changed;
    }
  }

  const replicationIndex = lines.findIndex((line) => /^\s*replication\s*:\s*$/.test(line));
  if (replicationIndex >= 0) {
    const baseIndentMatch = lines[replicationIndex].match(/^(\s*)replication\s*:\s*$/);
    const baseIndent = baseIndentMatch ? baseIndentMatch[1] : "";
    const currentIndent = baseIndent.length;

    let insertAt = replicationIndex + 1;
    while (insertAt < lines.length) {
      const current = lines[insertAt];
      if (current.trim() === "") {
        insertAt += 1;
        continue;
      }
      const indent = (current.match(/^(\s*)/) || ["", ""])[1].length;
      if (indent <= currentIndent) {
        break;
      }
      insertAt += 1;
    }

    lines.splice(insertAt, 0, `${baseIndent}  replSetName: rs0`);
    changed = true;
  } else {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push("replication:");
    lines.push("  replSetName: rs0");
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(cfgPath, lines.join(eol), "utf8");
  }
  return changed;
}

function restartMongoService() {
  try {
    const svcName = runCmd(
      `powershell -NoProfile -Command "$candidate = @('MongoDB','MongoDBServer') | ForEach-Object { Get-Service -Name $_ -ErrorAction SilentlyContinue } | Where-Object { $_ } | Select-Object -First 1; if (-not $candidate) { $candidate = Get-Service | Where-Object { $_.Name -match 'Mongo' } | Select-Object -First 1 }; if (-not $candidate) { throw 'MongoDB service not found' }; if ($candidate.Status -eq 'Running') { Stop-Service -Name $candidate.Name -Force -ErrorAction Stop; Start-Sleep -Seconds 1 }; Start-Service -Name $candidate.Name -ErrorAction Stop; $candidate.Name"`,
    );
    console.log(`MongoDB service restarted: ${svcName}`);
    return;
  } catch (error) {
    console.warn("PowerShell service restart failed. Trying net stop/start...");
    try {
      runCmd("net stop MongoDB");
    } catch (_) {
      // ignore stop failure, maybe already stopped
    }
    runCmd("net start MongoDB");
    console.log("MongoDB service restarted with net start.");
  }
}

function ensureMongoServiceRunning() {
  try {
    const output = runCmd(
      `powershell -NoProfile -Command "$candidate = @('MongoDB','MongoDBServer') | ForEach-Object { Get-Service -Name $_ -ErrorAction SilentlyContinue } | Where-Object { $_ } | Select-Object -First 1; if (-not $candidate) { $candidate = Get-Service | Where-Object { $_.Name -match 'Mongo' } | Select-Object -First 1 }; if (-not $candidate) { throw 'MongoDB service not found' }; if ($candidate.Status -ne 'Running') { Start-Service -Name $candidate.Name -ErrorAction Stop; Start-Sleep -Seconds 1 }; $candidate.Name + '|' + (Get-Service -Name $candidate.Name).Status"`,
    );
    const [name, status] = output.split("|");
    console.log(`MongoDB service status: ${name} => ${status}`);
    return true;
  } catch (_) {
    try {
      runCmd("net start MongoDB");
      console.log("MongoDB service started with net start.");
      return true;
    } catch {
      try {
        runCmd("net start MongoDBServer");
        console.log("MongoDBServer service started with net start.");
        return true;
      } catch {
        return false;
      }
    }
  }
}

async function readReplicaStatus() {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const admin = client.db("admin");
    const st = await admin.command({ replSetGetStatus: 1 });
    return { type: "ok", status: st };
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
    return { type: "error", code, message, raw: error };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function waitForMongoReachable(timeoutMs = 120000) {
  const started = Date.now();
  let lastMessage = "";

  while (Date.now() - started < timeoutMs) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 3000,
    });
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      return;
    } catch (error) {
      lastMessage =
        error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
      await wait(2000);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  throw new Error(`MongoDB did not become reachable in time. Last error: ${lastMessage}`);
}

async function initiateReplicaSet() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const admin = client.db("admin");
    await admin.command({ replSetInitiate: rsConfig });
  } finally {
    await client.close();
  }
}

async function waitForPrimary() {
  for (let i = 0; i < 30; i += 1) {
    const rs = await readReplicaStatus();
    if (rs.type === "ok") {
      const primary =
        Array.isArray(rs.status.members) && rs.status.members.find((member) => member.stateStr === "PRIMARY");
      if (primary) {
        console.log(`Replica set ready. PRIMARY=${primary.name}`);
        return;
      }
    }
    await wait(1000);
  }
  throw new Error("Replica set init command sent but PRIMARY not elected within timeout.");
}

async function run() {
  let initial = await readReplicaStatus();

  if (initial.type === "error" && isConnectionError(initial.message)) {
    console.log("Mongo is unreachable. Trying to start MongoDB service...");
    const started = ensureMongoServiceRunning();
    if (!started) {
      throw new Error(
        "MongoDB service could not be started automatically. Start MongoDB service manually, then rerun setup.",
      );
    }
    await waitForMongoReachable(120000);
    initial = await readReplicaStatus();
  }

  if (initial.type === "error" && initial.code === 76) {
    console.log("Mongo is running without --replSet. Applying automatic fix...");
    const cfgPath = guessMongoConfigPath();
    if (!cfgPath) {
      throw new Error("Could not detect mongod.cfg path automatically. Set MONGOD_CONFIG env and retry.");
    }
    if (!fs.existsSync(cfgPath)) {
      throw new Error(`mongod.cfg not found: ${cfgPath}`);
    }

    const changed = ensureReplicaSetInConfig(cfgPath);
    console.log(`mongod.cfg: ${cfgPath}`);
    console.log(changed ? "Updated replication.replSetName to rs0." : "Config already has replSetName: rs0.");

    restartMongoService();
    await waitForMongoReachable(120000);
  } else if (initial.type === "error" && /ECONNREFUSED|connect ECONNREFUSED/i.test(initial.message)) {
    throw new Error(
      "MongoDB is not reachable on localhost:27017. Start mongod (service) first, then rerun setup.",
    );
  } else if (initial.type === "error" && initial.code !== 94) {
    if (isConnectionError(initial.message)) {
      throw new Error(
        "MongoDB is still unreachable after startup attempts. Check Windows Services and mongod logs, then rerun setup.",
      );
    }
    throw initial.raw;
  }

  let afterFix = await readReplicaStatus();
  for (let i = 0; i < 20 && afterFix.type === "error" && isConnectionError(afterFix.message); i += 1) {
    await wait(2000);
    afterFix = await readReplicaStatus();
  }

  if (afterFix.type === "error") {
    if (afterFix.code === 76) {
      throw new Error(
        "Mongo still reports no replication after restart. Service may be using a different config file. Set MONGOD_CONFIG explicitly and rerun.",
      );
    }
    const isNotYetInitialized = afterFix.code === 94 || afterFix.message.includes("not yet initialized");
    if (!isNotYetInitialized) {
      if (isConnectionError(afterFix.message)) {
        throw new Error(
          "Mongo service restarted but still unreachable. Check Windows Services and mongod logs, then rerun setup.",
        );
      }
      throw afterFix.raw;
    }
    console.log("Replica set not initialized. Running rs.initiate...");
    await initiateReplicaSet();
  } else {
    const primary =
      Array.isArray(afterFix.status.members) && afterFix.status.members.find((member) => member.stateStr === "PRIMARY");
    if (primary) {
      console.log(`Replica set already initialized. PRIMARY=${primary.name}`);
      return;
    }
  }

  await waitForPrimary();
}

run().catch((error) => {
  console.error("Failed to setup local replica set.");
  console.error(error && error.message ? error.message : error);
  console.error("");
  console.error("Tip: run terminal as Administrator if service restart/config write fails.");
  process.exit(1);
});
