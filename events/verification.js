// events/verification.js

const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const helpers = require('../utils/helpers');
const pendingCaptchas = new Map();

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        if (member.user.bot) return;
        if (member.roles.cache.has(helpers.ids.roles.creator)) {
            console.log(`[Verify] ${member.user.tag} has Creator role – skipping Unverified role and verification.`);
            return;
        }

        const supporterRoleId = helpers.ids.roles.supporter;
        if (member.roles.cache.has(supporterRoleId)) return;
        const unverifiedRole = member.guild.roles.cache.get(helpers.ids.roles.unverified);
        if (unverifiedRole) {
            await member.roles.add(unverifiedRole).catch(console.error);
        }
    }
};

module.exports.handleInteraction = async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isButton() && interaction.customId === 'verify_modal_btn') {
        const cooldownKey = `verify_cooldown_${interaction.user.id}`;
if (pendingCaptchas.has(cooldownKey)) {
    return interaction.reply({
        content: `${helpers.releaseEmojis?.HOURGLASS || '⏳'} Please wait 30 seconds before trying again.`,
        flags: [MessageFlags.Ephemeral]
    }).catch(() => {});
}

        const mathQuestion = generateMathQuestion();
        const modal = new ModalBuilder()
            .setCustomId('verify_modal')
            .setTitle('Verification – Math Captcha');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('captcha_answer')
                    .setLabel(mathQuestion.text)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter your answer')
                    .setRequired(true)
            )
        );

        pendingCaptchas.set(interaction.user.id, mathQuestion.answer);
        pendingCaptchas.set(cooldownKey, true);
        setTimeout(() => {
            pendingCaptchas.delete(cooldownKey);
            pendingCaptchas.delete(interaction.user.id);
        }, 30000);

        await interaction.showModal(modal);
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const userAnswer = interaction.fields.getTextInputValue('captcha_answer');
        const expectedAnswer = pendingCaptchas.get(interaction.user.id);

        if (!expectedAnswer) {
            return interaction.editReply({
                content: `${helpers.releaseEmojis.BATSU} Verification session expired. Please click the button again.`
            });
        }

        const member = interaction.member;
        const supporterRoleId = helpers.ids.roles.supporter;
        const memberRoleId = helpers.ids.roles.member;
        const unverifiedRoleId = helpers.ids.roles.unverified;

        if (member.roles.cache.has(helpers.ids.roles.creator)) {
            return interaction.editReply({
                content: `${helpers.releaseEmojis.getRandomVerify()} You have the Creator role – no verification needed.`
            });
        }

        const hasSupporter = member.roles.cache.has(supporterRoleId);
        const unverifiedRole = interaction.guild.roles.cache.get(unverifiedRoleId);
        const memberRole = interaction.guild.roles.cache.get(memberRoleId);

        if (parseInt(userAnswer) === expectedAnswer) {
            if (hasSupporter) {
                if (unverifiedRole) await member.roles.remove(unverifiedRole);
                await interaction.editReply({
                    content: `${helpers.releaseEmojis.getRandomVerify()} You are already a Supporter – access granted.`
                });
            } else {
                if (memberRole && unverifiedRole) {
                    await member.roles.add(memberRole);
                    await member.roles.remove(unverifiedRole);
                }
                const successEmbed = new EmbedBuilder()
                    .setColor(0x2f3136)
                    .setDescription(
                        `# You Successfully Verified!\n` +
                        `Thanks for verifying!\n` +
                        `You now have the **Member** role and full access.`
                    )
                    .setImage('https://cdn.discordapp.com/attachments/1163490254221738015/1167472390213730335/Embed_Extender_Invisible_Space.png');
                await interaction.editReply({ embeds: [successEmbed] });
            }
            await logVerification(interaction.guild, member.user, true);
        } else {
            const failEmbed = new EmbedBuilder()
                .setDescription(`${helpers.releaseEmojis.BATSU} Verification unsuccessful. Please try again.`)
                .setColor(0xff8b1f);
            await interaction.editReply({ embeds: [failEmbed] });
            await logVerification(interaction.guild, interaction.user, false);
        }
        pendingCaptchas.delete(interaction.user.id);
    }
};

function generateMathQuestion() {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const operators = ['+', '-'];
    const op = operators[Math.floor(Math.random() * operators.length)];
    let answer, text;
    if (op === '+') {
        answer = a + b;
        text = `${a} + ${b} = ?`;
    } else {
        const max = Math.max(a, b);
        const min = Math.min(a, b);
        answer = max - min;
        text = `${max} - ${min} = ?`;
    }
    return { text, answer };
}

async function logVerification(guild, user, success) {
    const logChannelId = null;
    if (!logChannelId) return;
    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(success ? 0x00f0a8 : 0xff006f)
        .setTitle(success ? 'Verification Successful' : 'Verification Failed')
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .addFields(
            { name: 'User Info', value: `> **User:** ${user.tag} (<@${user.id}>)\n> **ID:** \`${user.id}\``, inline: false },
            { name: 'Action', value: success ? 'User passed verification' : 'User failed the captcha', inline: false }
        );
    await logChannel.send({ embeds: [embed] });
}
