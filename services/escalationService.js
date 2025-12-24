const Query = require('../models/Query');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');

const AUTO_ESCALATION_HOURS = 24;
const AUTO_OWNER_WAIT_HOURS = 12;

const runAutoEscalation = async () => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - AUTO_ESCALATION_HOURS);

    // Find pending queries older than cutoff
    const pendingQueries = await Query.find({
      status: 'pending',
      createdAt: { $lt: cutoffDate }
    }).populate('userId');

    if (pendingQueries.length === 0) return;

    console.log(`⏳ Auto-escalation: Found ${pendingQueries.length} queries to escalate.`);

    for (const query of pendingQueries) {
      try {
        // Create Ticket
        const ticket = new Ticket({
          reportedBy: query.userId._id,
          title: `Auto-Escalated: ${query.tag} Query`,
          description: `Automatically escalated after ${AUTO_ESCALATION_HOURS} hours of inactivity.\n\nOriginal Message: ${query.message}\n\nHistory:\n${query.history.map(h => `- ${h.message}`).join('\n')}`,
          category: 'other',
          department: query.tag || 'general',
          priority: 'medium',
          status: 'open',
          escalated: true,
          escalatedAt: new Date(),
          tags: ['ai-auto-escalation']
        });

        await ticket.save();

        // Update Query
        query.status = 'escalated';
        query.resolution = `Auto-escalated to Ticket #${ticket._id}`;
        await query.save();

        // Notify User (via Socket if possible, or just update state)
        if (global.io) {
            global.io.to(query.userId._id.toString()).emit('query:update', query);
        }

      } catch (err) {
        console.error(`Failed to auto-escalate query ${query._id}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Auto-escalation job failed:', error);
  }
};

module.exports = { runAutoEscalation };

const runAutoResolution = async () => {
  try {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - AUTO_OWNER_WAIT_HOURS);

    // Find queries where all collaborators resolved, owner still pending, older than cutoff
    const candidates = await Query.find({
      status: 'pending',
      ownerStatus: { $ne: 'resolved' },
      createdAt: { $lt: cutoff }
    });

    if (!candidates.length) return;

    let resolvedCount = 0;
    for (const q of candidates) {
      const allCollabsResolved = (q.collaboratorStatuses || []).every((cs) => cs.status === 'resolved');
      if (!allCollabsResolved) continue;

      q.ownerStatus = 'resolved';
      q.status = 'resolved';
      q.history.push({ sender: null, message: 'System: Auto-closed after collaborators resolved and owner idle.' });
      q.resolution = 'Auto-closed by system';
      await q.save();

      resolvedCount++;

      try {
        if (global.io && q.userId) {
          global.io.to(q.userId.toString()).emit('query:update', q);
        }
      } catch {}
    }

    if (resolvedCount) {
      console.log(`✅ Auto-resolution: closed ${resolvedCount} queries after ${AUTO_OWNER_WAIT_HOURS}h owner idle`);
    }
  } catch (e) {
    console.error('Auto-resolution job failed:', e);
  }
};

module.exports.runAutoResolution = runAutoResolution;