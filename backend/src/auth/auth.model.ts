import type { Db } from "mongodb";
import { usersCollection } from "../user/user.model";
import { sessionsCollection } from "./session.model";

export const authCollections = (db: Db) => ({
  users: usersCollection(db),
  sessions: sessionsCollection(db),
});

