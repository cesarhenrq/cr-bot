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
        .setCustomId(`pronto-${autorId}-${responsavelId}`)
        .setLabel("Finalizar CR")
        .setStyle(ButtonStyle.Success)
    );
  }

  return row;
}

function gerarMensagem({ task, autorId, link, status, responsavelId = null }) {
  const statusTexto = {
    aguardando: "🕒 **Aguardando responsável**",
    em_andamento: `🛠️ **Em andamento por** <@${responsavelId}>`,
    pronto: `✅ **Finalizado por** <@${responsavelId}>`,
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
      ? `Responsável pode clicar em **Finalizar CR** ao concluir.`
      : `CR concluído.`,
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

    if (acao === "pronto") {
      if (interaction.user.id !== responsavelId) {
        return interaction.reply({
          content: "Apenas quem assumiu o CR pode marcá-lo como pronto.",
          ephemeral: true,
        });
      }

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

      await msg.thread?.send(`CR finalizado por <@${responsavelId}>.`);

      await msg.thread?.send(
        `<@${autorId}>, o CR foi finalizado. Olhe o link do card ou pull request para validá-lo.`
      );

      const poRole = interaction.guild.roles.cache.find((r) => r.name === "PO");
      if (poRole) {
        await msg.thread?.send(`<@&${poRole.id}> o CR já foi finalizado.`);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
