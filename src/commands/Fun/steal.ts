import { FireMessage } from "../../../lib/extensions/message";
import { Language } from "../../../lib/util/language";
import { Command } from "../../../lib/util/command";
import * as centra from "centra";

const emojiRegex = /<a?:(?<name>[a-zA-Z0-9\_]+):(?<id>\d{15,21})>/im;

export default class Steal extends Command {
  constructor() {
    super("steal", {
      description: (language: Language) =>
        language.get("STEAL_COMMAND_DESCRIPTION"),
      clientPermissions: ["SEND_MESSAGES", "MANAGE_EMOJIS"],
      userPermissions: ["MANAGE_EMOJIS"],
      args: [
        {
          id: "emoji",
          type: "string",
          readableType: "emoji/emoji id/emoji url",
          slashCommandType: "emoji",
          default: null,
          required: true,
        },
        {
          id: "name",
          type: "string",
          default: null,
          required: false,
        },
      ],
      enableSlashCommand: true,
      ephemeral: true,
    });
  }

  async exec(message: FireMessage, args: { emoji: string; name?: string }) {
    let emoji = args.emoji;
    let name = args.name || "stolen_emoji";
    if (!emoji) return await message.error("STEAL_NOTHING");
    if (/^(\d{15,21})$/im.test(emoji.toString())) {
      emoji = `https://cdn.discordapp.com/emojis/${emoji}`;
      const format = await this.getFormat(emoji);
      if (!format) return await message.error("STEAL_INVALID_EMOJI");
      else emoji += format;
    } else if (emojiRegex.test(emoji)) {
      const match = emojiRegex.exec(emoji);
      emojiRegex.lastIndex = 0;
      emoji = `https://cdn.discordapp.com/emojis/${match.groups.id}.${
        match[0].startsWith("<a") ? "gif" : "png"
      }`;
      name = match.groups.name;
    } else if (
      !/^https?:\/\/cdn\.discordapp\.com(\/emojis\/\d{15,21})\.\w{3,4}/im.test(
        emoji
      )
    )
      return await message.error("STEAL_INVALID_EMOJI");
    let created;
    try {
      created = await message.guild.emojis.create(emoji, name);
    } catch {
      return await message.error("STEAL_CAUGHT");
    }
    return await message.success("STEAL_STOLEN", created.toString());
  }

  async getFormat(url: string) {
    const emojiReq = await centra(`${url}.gif`)
      .header("User-Agent", "Fire Discord Bot")
      .send();
    if (emojiReq.statusCode == 415) return ".png";
    else if ([200, 304].includes(emojiReq.statusCode)) return ".gif";
    else return false;
  }
}
