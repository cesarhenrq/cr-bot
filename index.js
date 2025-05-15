const express = require("express");
const cron = require("node-cron");
const axios = require("axios");
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} = require("discord.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is alive!"));

app.listen(PORT, () => {
  console.log(`🌐 Web server rodando na porta ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

const command = new SlashCommandBuilder()
  .setName("solicitar-cr")
  .setDescription("Solicita um Code Review (CR)")
  .addStringOption((option) =>
    option
      .setName("task")
      .setDescription("Título da task (ex: Ajustar layout da home)")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("link")
      .setDescription("Link do card ou pull request")
      .setRequired(true)
  );

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

client.once("ready", async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);

  const guilds = await client.guilds.fetch();
  for (const [guildId] of guilds) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
      body: [command.toJSON()],
    });
    console.log(`📌 Comando registrado na guild ${guildId}`);
  }
});

function criarBotoes(status, autorId, responsavelId = null) {
  const row = new ActionRowBuilder();

  if (status === "aguardando") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`assumir-${autorId}`)
        .setLabel("Assumir CR")
        .setStyle(ButtonStyle.Primary)
    );
  } else if (status === "em_andamento") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`solicitar_alteracoes-${autorId}-${responsavelId}`)
        .setLabel("Solicitar alterações")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`aprovado-${autorId}-${responsavelId}`)
        .setLabel("Aprovar CR")
        .setStyle(ButtonStyle.Success)
    );
  } else if (status === "revisado") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`revisar_novamente-${autorId}-${responsavelId}`)
        .setLabel("Solicitar nova revisão")
        .setStyle(ButtonStyle.Primary)
    );
  } else if (status === "aprovado") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`finalizado-${autorId}-${responsavelId}`)
        .setLabel("Finalizar")
        .setStyle(ButtonStyle.Success)
    );
  }

  return row;
}

function gerarMensagem({ task, autorId, link, status, responsavelId = null }) {
  const statusTexto = {
    aguardando: "🕒 **Aguardando responsável**",
    em_andamento: `🛠️ **Em andamento por** <@${responsavelId}>`,
    revisado: `✏️ **Revisado com comentários por** <@${responsavelId}>`,
    aprovado: `✅ **Aprovado por** <@${responsavelId}>`,
    pronto: `🎉 **Finalizado por** <@${autorId}>`,
  };

  return [
    `**📋 Code Review Solicitado**`,
    ``,
    `**Task:** ${task}`,
    `**Solicitante:** <@${autorId}>`,
    `**Link:** ${link}`,
    `**Status:** ${statusTexto[status]}`,
    ``,
    status === "aguardando"
      ? `Caso deseje revisar, clique em **Assumir CR**.`
      : status === "em_andamento"
      ? `Responsável pode **solicitar alterações** ou **aprovar CR** ao concluir.`
      : status === "revisado"
      ? `Autor pode **solicitar nova revisão** ao finalizar as alterações solicitadas.`
      : status === "aprovado"
      ? `Caso tenha realizado o merge, por favor, clique em **Finalizar**.`
      : status === "pronto"
      ? `CR concluído.`
      : "",
  ].join("\n");
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "solicitar-cr"
  ) {
    const task = interaction.options.getString("task");
    const link = interaction.options.getString("link");
    const autorId = interaction.user.id;

    const devRole = interaction.guild.roles.cache.find((r) => r.name === "Dev");
    const mention = devRole ? `<@&${devRole.id}>\n\n` : "";

    const mensagem =
      mention +
      gerarMensagem({
        task,
        autorId,
        link,
        status: "aguardando",
      });

    const reply = await interaction.reply({
      content: mensagem,
      components: [criarBotoes("aguardando", autorId)],
      fetchReply: true,
    });

    const thread = await reply.startThread({
      name: `CR – ${task}`,
      autoArchiveDuration: 1440,
    });

    thread.send(`Discussão iniciada para a task **${task}**.`);
  }

  if (interaction.isButton()) {
    const [acao, autorId, responsavelId] = interaction.customId.split("-");

    const msg = interaction.message;
    const lines = msg.content.split("\n");
    const taskLine = lines.find((line) => line.startsWith("**Task:**"));
    const task = taskLine?.replace("**Task:** ", "").trim();
    const link = lines
      .find((line) => line.startsWith("**Link:**"))
      ?.replace("**Link:** ", "")
      .trim();

    if (acao === "assumir") {
      const responsavel = interaction.user;
      const mensagemAtualizada = gerarMensagem({
        task,
        autorId,
        link,
        status: "em_andamento",
        responsavelId: responsavel.id,
      });

      await interaction.update({
        content: mensagemAtualizada,
        components: [criarBotoes("em_andamento", autorId, responsavel.id)],
      });

      await msg.thread?.send(`<@${responsavel.id}> assumiu este CR.`);
    }

    if (acao === "solicitar_alteracoes") {
      if (interaction.user.id !== responsavelId)
        return interaction.reply({
          content: "Apenas o responsável pode solicitar alteracoes.",
          ephemeral: true,
        });

      const mensagemAtualizada = gerarMensagem({
        task,
        autorId,
        link,
        status: "revisado",
        responsavelId,
      });

      await interaction.update({
        content: mensagemAtualizada,
        components: [criarBotoes("revisado", autorId, responsavelId)],
      });

      await msg.thread?.send(
        `<@${autorId}>, o código foi revisado e contém comentários. Realize os ajustes e clique em **Solicitar nova revisão**.`
      );

      const poRole = interaction.guild.roles.cache.find((r) => r.name === "PO");
      if (poRole) {
        await msg.thread?.send(
          `<@&${poRole.id}> o CR foi revisado e precisa de ajustes.`
        );
      }
    }

    if (acao === "revisar_novamente") {
      if (interaction.user.id !== autorId)
        return interaction.reply({
          content: "Apenas o autor do PR pode solicitar nova revisão.",
          ephemeral: true,
        });

      const mensagemAtualizada = gerarMensagem({
        task,
        autorId,
        link,
        status: "em_andamento",
        responsavelId,
      });

      await interaction.update({
        content: mensagemAtualizada,
        components: [criarBotoes("em_andamento", autorId, responsavelId)],
      });

      await msg.thread?.send(`<@${autorId}> solicitou nova revisão do código.`);
    }

    if (acao === "aprovado") {
      if (interaction.user.id !== responsavelId)
        return interaction.reply({
          content: "Apenas o responsável pode aprovar.",
          ephemeral: true,
        });

      const mensagemAtualizada = gerarMensagem({
        task,
        autorId,
        link,
        status: "aprovado",
        responsavelId,
      });

      await interaction.update({
        content: mensagemAtualizada,
        components: [criarBotoes("aprovado", autorId, responsavelId)],
      });

      await msg.thread?.send(
        `<@${autorId}>, o código foi aprovado. Faça o merge e depois clique em **Finalizar**.`
      );

      const poRole = interaction.guild.roles.cache.find((r) => r.name === "PO");
      if (poRole) {
        await msg.thread?.send(
          `<@&${poRole.id}> o CR foi aprovado e aguarda merge.`
        );
      }
    }

    if (acao === "finalizado") {
      if (interaction.user.id !== autorId)
        return interaction.reply({
          content: "Apenas o autor pode finalizar.",
          ephemeral: true,
        });

      const mensagemAtualizada = gerarMensagem({
        task,
        autorId,
        link,
        status: "pronto",
        responsavelId,
      });

      await interaction.update({
        content: mensagemAtualizada,
        components: [],
      });

      await msg.thread?.send(`✅ CR finalizado após merge por <@${autorId}>.`);

      const poRole = interaction.guild.roles.cache.find((r) => r.name === "PO");
      if (poRole) {
        await msg.thread?.send(
          `<@&${poRole.id}> o CR foi finalizado e mergeado.`
        );
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

const SELF_URL = "https://cr-bot-iz1x.onrender.com";

cron.schedule("*/14 * * * *", async () => {
  try {
    await axios.get(SELF_URL);
    console.log("🔁 Self-ping enviado");
  } catch (error) {
    console.error("❌ Erro ao enviar self-ping:", error.message);
  }
});
