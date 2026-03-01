// roleRemover.js
module.exports = (client) => {
  const guildId = process.env.GUILD_ID;
  const role1 = '1467233133362544642';  // SubscribeStar All Subscribers
  const role2 = '1468666174102442227';  // SubscribeStar $0.00 tier
  const checkInterval = 1800000;        // 30 minutes = 30 * 60 * 1000 ms  (change back to 3600000 for 1 hour)

  // On member join → remove roles immediately if present
  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== guildId) return;
    const rolesToRemove = [];
    if (member.roles.cache.has(role1)) rolesToRemove.push(role1);
    if (member.roles.cache.has(role2)) rolesToRemove.push(role2);

    if (rolesToRemove.length > 0) {
      try {
        await member.roles.remove(rolesToRemove);
        console.log(`Removed roles from new member: ${member.user.tag} (${rolesToRemove.join(', ')})`);
      } catch (error) {
        console.error(`Failed to remove roles from new member ${member.user.tag}:`, error);
      }
    }
  });

  // Periodic check → every X minutes
  setInterval(async () => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return console.error('Guild not found');

    try {
      // Fetch all members if not cached (large servers may need this)
      await guild.members.fetch();

      // Filter only members with the unwanted roles
      const suspects = guild.members.cache.filter(member =>
        member.roles.cache.has(role1) || member.roles.cache.has(role2)
      );

      console.log(`Periodic check: Found ${suspects.size} members with unwanted roles`);

      for (const member of suspects.values()) {
        const rolesToRemove = [];
        if (member.roles.cache.has(role1)) rolesToRemove.push(role1);
        if (member.roles.cache.has(role2)) rolesToRemove.push(role2);

        if (rolesToRemove.length > 0) {
          try {
            await member.roles.remove(rolesToRemove);
            console.log(`Removed roles from ${member.user.tag} (periodic) - ${rolesToRemove.join(', ')}`);
            await new Promise(resolve => setTimeout(resolve, 1000));  // 1s delay to avoid rate limits
          } catch (error) {
            console.error(`Failed to remove roles from ${member.user.tag} (periodic):`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error in periodic role check:', error);
    }
  }, checkInterval);

  console.log(`Role remover setup complete (checks every ${checkInterval / 60000} minutes)`);
};
