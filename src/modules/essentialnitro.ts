import { EssentialTransaction } from "@fire/lib/interfaces/essential";
import { FireMember } from "@fire/lib/extensions/guildmember";
import { FireGuild } from "@fire/lib/extensions/guild";
import { FireUser } from "@fire/lib/extensions/user";
import { Collection, Snowflake } from "discord.js";
import { Module } from "@fire/lib/util/module";
import * as centra from "centra";

export default class EssentialNitro extends Module {
  constructor() {
    super("essentialnitro");
  }

  get auth() {
    return process.env.ESSENTIAL_AUTH
      ? `Bearer ${process.env.ESSENTIAL_AUTH}`
      : null;
  }

  async init() {
    await this.client.waitUntilReady();
    await this.nitroChecker();
  }

  async nitroChecker() {
    const guilds = [
      this.client.guilds.cache.get("864592657572560958"),
      this.client.guilds.cache.get("411619823445999637"),
    ].filter((guild: FireGuild) => guild?.hasExperiment(223827992, 1));
    if (!guilds.length) return;
    let users: Snowflake[] = [];
    const essentialResult = await this.client.db.query(
      "SELECT uid FROM essential;"
    );
    for await (const row of essentialResult) {
      users.push(row.get("uid") as Snowflake);
    }
    const memberIds: Snowflake[] = [];
    for (const guild of guilds) {
      const boosterId = guild.roles.cache.find(
        (r) => r.tags?.premiumSubscriberRole
      )?.id;
      if (!boosterId) continue; // oops something brokey
      const members = (await guild.members.fetch({
        user: users,
      })) as Collection<string, FireMember>;
      memberIds.push(...members.map((m) => m.id));
      for (const [, member] of members) {
        if (!member.roles.cache.has(boosterId) && !member.isSuperuser()) {
          this.client.console.warn(
            `[Essential] Removing nitro cosmetic from ${member} due to lack of booster role`
          );
          const removed = await this.removeNitroCosmetic(member).catch(
            () => {}
          );
          if (!removed || typeof removed == "number")
            this.client.console.error(
              `[Essential] Failed to remove nitro cosmetic from ${member}${
                typeof removed == "number" ? ` with status code ${removed}` : ""
              }`
            );
        }
      }
    }
    users = users.filter((u) => !memberIds.includes(u));
    if (users.length) {
      users.forEach(async (id) => {
        this.client.console.warn(
          `[Essential] Removing nitro cosmetic from ${id} due to lack of existence`
        );
        const user = (await this.client.users
          .fetch(id)
          .catch(() => {})) as FireUser;
        if (user) {
          const removed = await this.removeNitroCosmetic(user).catch(() => {});
          if (!removed || typeof removed == "number")
            this.client.console.error(
              `[Essential] Failed to remove nitro cosmetic from ${user} (${
                user.id
              })${
                typeof removed == "number" ? ` with status code ${removed}` : ""
              }`
            );
        }
      });
    }
  }

  async getUUID(user: FireMember | FireUser) {
    const result = await this.client.db
      .query("SELECT uuid FROM essential WHERE uid=$1;", [user.id])
      .first()
      .catch(() => {});
    if (!result) return null;

    return result.get("uuid") as string;
  }

  async setUUID(user: FireMember | FireUser, uuid: string) {
    try {
      const current = await this.getUUID(user);
      if (current)
        await this.client.db.query(
          "UPDATE essential SET uuid=$1 WHERE uid=$2;",
          [uuid, user.id]
        );
      else
        await this.client.db.query(
          "INSERT INTO essential (uid, uuid) VALUES ($1, $2);",
          [user.id, uuid]
        );
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentTransactions(
    user: FireMember | FireUser
  ): Promise<EssentialTransaction[]> {
    if (!this.auth) return null;
    const uuid = await this.getUUID(user);
    if (!uuid) return [];

    const transReq = await centra(
      `https://api.essential.gg/v2/discord/nitro/${uuid}`
    )
      .header("User-Agent", this.client.manager.ua)
      .header("Authorization", this.auth)
      .send();
    if (transReq.statusCode != 200) return [];

    return await transReq.json();
  }

  async giveNitroCosmetic(user: FireMember | FireUser, ign: string) {
    if (!this.auth) return false;
    const uuid = await this.client.util.nameToUUID(ign, true);
    if (!uuid) return false;

    const setUUID = await this.setUUID(user, uuid);
    if (!setUUID) return false;

    const existing = await this.getCurrentTransactions(user);
    if (
      existing.length &&
      existing.every((t) => t.status.expiration < +new Date())
    )
      return true;
    else await this.removeNitroCosmetic(user); // remove old "transactions"

    const body = {
      username: ign,
      user_id: uuid,
    };

    const nitroReq = await centra(
      "https://api.essential.gg/v2/discord/nitro",
      "POST"
    )
      .header("Content-Type", "application/x-www-form-urlencoded")
      .header("User-Agent", this.client.manager.ua)
      .header("Authorization", this.auth)
      .body(body, "form")
      .send();

    return nitroReq.statusCode == 201;
  }

  async removeNitroCosmetic(user: FireMember | FireUser) {
    if (!this.auth) return false;
    const uuid = await this.getUUID(user);
    if (!uuid) return false;

    const nitroReq = await centra(
      "https://api.essential.gg/v2/discord/nitro",
      "DELETE"
    )
      .header("Content-Type", "application/x-www-form-urlencoded")
      .header("User-Agent", this.client.manager.ua)
      .header("Authorization", this.auth)
      .query("user_id", uuid)
      .send();

    if (nitroReq.statusCode == 200) {
      const result = await this.client.db
        .query("DELETE FROM essential WHERE uid=$1 RETURNING uid;", [user.id])
        .first();
      if (result && result.get("uid") == user.id) return true;
      else {
        this.client.console.error(
          `[Essential] Failed to remove uuid from database for ${user} (${user.id})`
        );
        return false;
      }
    } else return nitroReq.statusCode;
  }
}
