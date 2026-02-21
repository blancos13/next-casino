# Win2x Backend

TypeScript backend for Win2x with:
- Raw WebSocket transport (`ws`)
- MongoDB (transactions + change streams)
- Request idempotency (`requestId`)
- Mongo lock leases
- JWT auth + refresh sessions

## Run

1. Copy `.env.example` to `.env` and update values.
   - `MONGO_URI=mongodb://localhost:27017/win2x?replicaSet=rs0`
   - `MONGO_DB_NAME=win2x`
2. Install dependencies.
3. Start dev server.

```bash
npm install
npm run dev
```

WS endpoint defaults to `ws://localhost:8080/ws`.
Health endpoints:
- `GET /health`
- `GET /metrics`

## Local Mongo Replica Set (rs0)

Connection string uses replica set:
- `mongodb://localhost:27017/win2x?replicaSet=rs0`

If you get `ReplicaSetNoPrimary`:

1. Ensure MongoDB server is running on `localhost:27017`.
2. In backend folder run:

```bash
npm run mongo:setup-rs
```

3. Start backend again:

```bash
npm run dev
```

If `npm run mongo:setup-rs` prints `not running with --replSet`:

1. Enable replica set mode in Mongo config (`mongod.cfg`):

```yaml
replication:
  replSetName: rs0
```

2. Restart MongoDB service.
3. Run:

```bash
npm run mongo:setup-rs
npm run dev
```

`npm run mongo:setup-rs` now tries to do this automatically:
- start MongoDB service if it is not running
- detect `mongod.cfg`
- set `replication.replSetName: rs0`
- restart MongoDB service
- run `rs.initiate`
- wait until Mongo is reachable and PRIMARY is elected

## Command Envelope

```ts
type WsRequest<T> = {
  type: string;
  requestId: string;
  ts: number;
  auth?: { accessToken: string };
  data: T;
};
```

Mutating commands require `requestId`.

## Core Commands

- Auth: `auth.register`, `auth.login`, `auth.refresh`, `auth.logout`, `auth.me`
- Wallet: `wallet.balance.get`, `wallet.deposit.request`, `wallet.withdraw.request`, `wallet.exchange`
- Promo: `promo.redeem`
- Games: `dice.bet`, `crash.*`, `jackpot.*`, `wheel.*`, `coinflip.*`, `battle.*`
- Chat: `chat.subscribe`, `chat.history`, `chat.send`
- Bonus: `bonus.getWheel`, `bonus.spin`
