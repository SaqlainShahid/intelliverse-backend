const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ForumPost = require('../models/ForumPost');
const User = require('../models/User');

const POPULATE_AUTHOR = 'profile.firstName profile.lastName profile.avatar profile.department role profile.designation';

router.use(authenticate);

// GET /api/forum/posts — list with filters
router.get('/posts', async (req, res) => {
  try {
    const { category, status, sort = 'newest', search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (category && category !== 'all') filter.category = category;
    if (status && status !== 'all') filter.status = status;
    if (search) filter.$text = { $search: search };

    let sortObj = { createdAt: -1 };
    if (sort === 'upvotes') sortObj = { 'upvotes.length': -1, createdAt: -1 };
    if (sort === 'unanswered') { filter['answers.0'] = { $exists: false }; sortObj = { createdAt: -1 }; }
    if (sort === 'active') sortObj = { updatedAt: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [posts, total] = await Promise.all([
      ForumPost.find(filter)
        .populate('author', POPULATE_AUTHOR)
        .select('title category upvotes answers status views forwardedToFaculty createdAt author')
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ForumPost.countDocuments(filter),
    ]);

    const mapped = posts.map(p => ({
      ...p,
      upvoteCount: p.upvotes.length,
      answerCount: p.answers.length,
      hasAcceptedAnswer: p.answers.some(a => a.isAccepted),
      isUpvoted: p.upvotes.map(id => id.toString()).includes(req.user._id.toString()),
    }));

    return res.json({ success: true, data: mapped, total, page: parseInt(page) });
  } catch (e) {
    console.error('[forum] list error:', e);
    return res.status(500).json({ success: false, message: 'Failed to fetch posts' });
  }
});

// POST /api/forum/posts — create question
router.post('/posts', async (req, res) => {
  try {
    const { title, body, category } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ success: false, message: 'Title and body are required' });
    }

    const post = await ForumPost.create({
      title: title.trim(),
      body: body.trim(),
      category: category || 'Other',
      author: req.user._id,
    });

    const populated = await ForumPost.findById(post._id).populate('author', POPULATE_AUTHOR).lean();

    if (global.io) global.io.emit('forum:post:new', { post: populated });

    return res.status(201).json({ success: true, data: populated });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create post' });
  }
});

// GET /api/forum/posts/:id — full thread
router.get('/posts/:id', async (req, res) => {
  try {
    const post = await ForumPost.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    )
      .populate('author', POPULATE_AUTHOR)
      .populate('answers.author', POPULATE_AUTHOR)
      .populate('forwardedBy', POPULATE_AUTHOR)
      .lean();

    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    // Sort answers: accepted first, then by upvote count desc
    post.answers.sort((a, b) => {
      if (a.isAccepted !== b.isAccepted) return b.isAccepted ? 1 : -1;
      return b.upvotes.length - a.upvotes.length;
    });

    const enriched = {
      ...post,
      upvoteCount: post.upvotes.length,
      isUpvoted: post.upvotes.map(id => id.toString()).includes(req.user._id.toString()),
      answers: post.answers.map(a => ({
        ...a,
        upvoteCount: a.upvotes.length,
        isUpvoted: a.upvotes.map(id => id.toString()).includes(req.user._id.toString()),
      })),
    };

    return res.json({ success: true, data: enriched });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch post' });
  }
});

// PATCH /api/forum/posts/:id/upvote — toggle upvote
router.patch('/posts/:id/upvote', async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const userId = req.user._id.toString();
    const idx = post.upvotes.map(id => id.toString()).indexOf(userId);
    if (idx === -1) post.upvotes.push(req.user._id);
    else post.upvotes.splice(idx, 1);

    await post.save();
    return res.json({ success: true, data: { upvoteCount: post.upvotes.length, isUpvoted: idx === -1 } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update upvote' });
  }
});

// POST /api/forum/posts/:id/answers — post an answer
router.post('/posts/:id/answers', async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: 'Answer body is required' });

    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    post.answers.push({ author: req.user._id, body: body.trim() });
    if (post.status === 'open') post.status = 'answered';
    await post.save();

    const populated = await ForumPost.findById(post._id)
      .populate('author', POPULATE_AUTHOR)
      .populate('answers.author', POPULATE_AUTHOR)
      .lean();

    if (global.io) {
      global.io.to(post.author.toString()).emit('forum:answer:new', { postId: post._id });
    }

    return res.status(201).json({ success: true, data: populated });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to post answer' });
  }
});

// PATCH /api/forum/posts/:id/answers/:answerId/upvote — toggle answer upvote
router.patch('/posts/:id/answers/:answerId/upvote', async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const answer = post.answers.id(req.params.answerId);
    if (!answer) return res.status(404).json({ success: false, message: 'Answer not found' });

    const userId = req.user._id.toString();
    const idx = answer.upvotes.map(id => id.toString()).indexOf(userId);
    if (idx === -1) answer.upvotes.push(req.user._id);
    else answer.upvotes.splice(idx, 1);

    await post.save();
    return res.json({ success: true, data: { upvoteCount: answer.upvotes.length, isUpvoted: idx === -1 } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update answer upvote' });
  }
});

// PATCH /api/forum/posts/:id/answers/:answerId/accept — mark best answer (post author only)
router.patch('/posts/:id/answers/:answerId/accept', async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    if (post.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the post author can accept an answer' });
    }

    // Toggle — un-accept if already accepted, accept otherwise
    const target = post.answers.id(req.params.answerId);
    if (!target) return res.status(404).json({ success: false, message: 'Answer not found' });

    const wasAccepted = target.isAccepted;
    post.answers.forEach(a => { a.isAccepted = false; });
    target.isAccepted = !wasAccepted;
    if (!wasAccepted) post.status = 'answered';

    await post.save();

    if (global.io && !wasAccepted) {
      global.io.to(target.author.toString()).emit('forum:answer:accepted', { postId: post._id });
    }

    return res.json({ success: true, data: { isAccepted: target.isAccepted } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to accept answer' });
  }
});

// POST /api/forum/posts/:id/forward — forward to faculty
router.post('/posts/:id/forward', async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id).populate('author', POPULATE_AUTHOR);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    post.forwardedToFaculty = true;
    post.forwardedAt = new Date();
    post.forwardedBy = req.user._id;
    post.status = 'forwarded';
    await post.save();

    // Notify all faculty members via socket
    if (global.io) {
      const facultyUsers = await User.find({ role: { $in: ['faculty', 'hod'] }, isActive: true }).select('_id').lean();
      facultyUsers.forEach(f => {
        global.io.to(f._id.toString()).emit('forum:forwarded', {
          postId: post._id,
          title: post.title,
          forwardedBy: req.user._id,
        });
      });
    }

    return res.json({ success: true, data: { forwardedToFaculty: true } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to forward post' });
  }
});

// DELETE /api/forum/posts/:id — delete (author or admin)
router.delete('/posts/:id', async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    if (post.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    await post.deleteOne();
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to delete post' });
  }
});

// DELETE /api/forum/posts/:id/answers/:answerId — delete an answer (author or admin)
router.delete('/posts/:id/answers/:answerId', async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const answer = post.answers.id(req.params.answerId);
    if (!answer) return res.status(404).json({ success: false, message: 'Answer not found' });
    if (answer.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    answer.deleteOne();
    if (post.answers.every(a => !a.isAccepted) && post.status === 'answered') post.status = 'open';
    await post.save();

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to delete answer' });
  }
});

module.exports = router;
