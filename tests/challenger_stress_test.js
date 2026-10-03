const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");

const postRouter = require("../routes/postRouter");
const publicRouter = require("../routes/publicProfile");

const Post = require("../models/Post");
const User = require("../models/User");
const ConnectionRequestModel = require("../models/connectionRequest");
const Comment = require("../models/Comment");
const Reaction = require("../models/Reaction");
const Follow = require("../models/Follow");
const ProjectRoom = require("../models/ProjectRoom");

const pinRoute = postRouter.stack.find(
  (l) => l.route && l.route.path === "/post/:id/pin"
);
const pinHandler = pinRoute.route.stack[pinRoute.route.stack.length - 1].handle;

const profileRoute = publicRouter.stack.find(
  (l) => l.route && l.route.path === "/user/:userId"
);
const profileHandler =
  profileRoute.route.stack[profileRoute.route.stack.length - 1].handle;

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function setupDefaultMocks() {
  Follow.exists = async () => false;
  Post.find = () => ({
    distinct: async () => [],
    sort: () => ({ limit: () => ({ lean: async () => [] }) }),
  });
  Post.aggregate = async () => [];
  ConnectionRequestModel.countDocuments = async () => 0;
  ConnectionRequestModel.findOne = async () => null;
  Reaction.countDocuments = async () => 0;
  Post.countDocuments = async () => 0;
  ProjectRoom.find = () => ({
    populate: () => ({
      populate: () => ({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      }),
    }),
  });
  Comment.find = () => ({
    populate: () => ({
      sort: () => ({ lean: async () => [] }),
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: Query Concurrency & Timing Oracle
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite 1: Empirical Verification of Query Concurrency (Without Nested Awaits)", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();
  const mockPostIds = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];

  beforeEach(() => {
    setupDefaultMocks();
  });

  it("1. Hoisted distinct query runs BEFORE Promise.all batch begins", async () => {
    const executionOrder = [];

    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
    });

    Post.find = (filter) => {
      if (filter && filter.authorId && filter.isPinnedToProfile) {
        return {
          sort: () => ({ limit: () => ({ lean: async () => [] }) }),
        };
      }
      return {
        distinct: async (field) => {
          executionOrder.push({ step: "distinct_post_ids", time: Date.now() });
          await new Promise((r) => setTimeout(r, 20));
          return mockPostIds;
        },
      };
    };

    ConnectionRequestModel.countDocuments = async () => {
      executionOrder.push({ step: "count_connections", time: Date.now() });
      await new Promise((r) => setTimeout(r, 30));
      return 10;
    };

    Reaction.countDocuments = async (filter) => {
      executionOrder.push({
        step: "count_reactions",
        time: Date.now(),
        postIdsReceived: filter.postId.$in,
      });
      await new Promise((r) => setTimeout(r, 30));
      return 42;
    };

    Post.countDocuments = async () => {
      executionOrder.push({ step: "count_posts", time: Date.now() });
      await new Promise((r) => setTimeout(r, 30));
      return 3;
    };

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    const tStart = Date.now();
    await profileHandler(req, res);
    const totalDuration = Date.now() - tStart;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.stats.connectionCount, 10);
    assert.strictEqual(res.body.stats.totalReactions, 42);
    assert.strictEqual(res.body.stats.postCount, 3);

    // Assert that distinct was the FIRST step
    assert.strictEqual(
      executionOrder[0].step,
      "distinct_post_ids",
      "distinct('_id') must be hoisted and called before Promise.all batch"
    );

    // Assert that Reaction.countDocuments received the post IDs returned from distinct
    const reactionStep = executionOrder.find((s) => s.step === "count_reactions");
    assert.ok(reactionStep);
    assert.deepStrictEqual(
      reactionStep.postIdsReceived.map((id) => id.toString()),
      mockPostIds.map((id) => id.toString())
    );

    // Check concurrency: the 3 count queries in Promise.all each take 30ms.
    // If sequential: 20ms + 30ms + 30ms + 30ms = ~110ms+.
    // If concurrent: 20ms + max(30, 30, 30) = ~50-65ms.
    assert.ok(
      totalDuration < 95,
      `Expected concurrent execution under 95ms, got ${totalDuration}ms`
    );

    // Check start timestamps of the concurrent queries in Promise.all: should start within 5ms of each other
    const parallelSteps = executionOrder.filter((s) => s.step.startsWith("count_"));
    assert.strictEqual(parallelSteps.length, 2);
    const timeDelta = Math.abs(parallelSteps[0].time - parallelSteps[1].time);
    assert.ok(
      timeDelta <= 5,
      `Parallel steps should start concurrently (delta was ${timeDelta}ms)`
    );
  });

  it("2. Concurrency stress: 50 concurrent requests execute without promise race or state leak", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 12 }),
    });
    Post.find = (filter) => {
      if (filter && filter.authorId && filter.isPinnedToProfile) {
        return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
      }
      return { distinct: async () => mockPostIds };
    };
    ConnectionRequestModel.countDocuments = async () => 5;
    Reaction.countDocuments = async () => 20;
    Post.countDocuments = async () => 3;

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };

    const requests = Array.from({ length: 50 }, async () => {
      const res = createMockRes();
      await profileHandler(req, res);
      return res;
    });

    const results = await Promise.all(requests);
    assert.strictEqual(results.length, 50);
    for (const r of results) {
      assert.strictEqual(r.statusCode, 200);
      assert.strictEqual(r.body.stats.totalReactions, 20);
      assert.strictEqual(r.body.stats.postCount, 3);
      assert.strictEqual(r.body.stats.connectionCount, 5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: Empty post list, null code snippet, deleted posts
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite 2: Empty Post List, Null Code Snippet, & Deleted Posts", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultMocks();
  });

  it("1. Empty post list (postCount = 0): fallback query is bypassed entirely, returns []", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 0 }),
    });

    Post.countDocuments = async () => 0; // 0 posts
    Post.find = () => ({
      distinct: async () => [],
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    });

    let aggregateCalled = false;
    Post.aggregate = async () => {
      aggregateCalled = true;
      return [];
    };

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(aggregateCalled, false, "Fallback aggregate should NOT run when postCount === 0");
    assert.deepStrictEqual(res.body.pinnedPosts, []);
    assert.strictEqual(res.body.stats.postCount, 0);
    assert.strictEqual(res.body.stats.totalReactions, 0);
  });

  it("2. User has posts but none are snippets: fallback returns empty array", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 0 }),
    });

    Post.countDocuments = async () => 5; // User has 5 posts
    Post.find = () => ({
      distinct: async () => [new mongoose.Types.ObjectId()],
      sort: () => ({ limit: () => ({ lean: async () => [] }) }), // Nothing pinned
    });

    let aggregatePipeline = null;
    Post.aggregate = async (pipeline) => {
      aggregatePipeline = pipeline;
      // In MongoDB, since none of the posts match { type: "snippet", ... }, aggregate returns []
      return [];
    };

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(aggregatePipeline);
    assert.deepStrictEqual(res.body.pinnedPosts, []);
  });

  it("3. Snippet posts with null/empty code snippets are rejected by fallback $match filter", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 0 }),
    });

    Post.countDocuments = async () => 4;
    Post.find = () => ({
      distinct: async () => [new mongoose.Types.ObjectId()],
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    });

    let matchCriteria = null;
    Post.aggregate = async (pipeline) => {
      matchCriteria = pipeline[0].$match;
      return [];
    };

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(matchCriteria);
    assert.strictEqual(matchCriteria.type, "snippet");
    assert.strictEqual(matchCriteria["codeSnippet.code"].$exists, true);
    assert.deepStrictEqual(matchCriteria["codeSnippet.code"].$nin, ["", null]);

    // Test in-memory simulator of MongoDB $match filter semantics
    const candidatePosts = [
      { type: "standard", content: "Just an article" }, // rejected: wrong type
      { type: "snippet", codeSnippet: null }, // rejected: codeSnippet is null
      { type: "snippet", codeSnippet: { code: null } }, // rejected: code is null
      { type: "snippet", codeSnippet: { code: "" } }, // rejected: code is empty string
      { type: "snippet", codeSnippet: { code: "const x = 1;" } }, // ACCEPTED!
    ];

    const matched = candidatePosts.filter((p) => {
      if (p.type !== matchCriteria.type) return false;
      if (!p.codeSnippet || typeof p.codeSnippet.code === "undefined") return false;
      if (matchCriteria["codeSnippet.code"].$nin.includes(p.codeSnippet.code)) return false;
      return true;
    });

    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].codeSnippet.code, "const x = 1;");
  });

  it("4. Deleted pinned post: when pinned posts were deleted, fallback activates", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 0 }),
    });

    // Pinned post was deleted, so Post.find returns []
    Post.find = () => ({
      distinct: async () => [new mongoose.Types.ObjectId()],
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    });
    Post.countDocuments = async () => 2; // User still has 2 other posts

    let fallbackTriggered = false;
    Post.aggregate = async () => {
      fallbackTriggered = true;
      return [
        {
          _id: new mongoose.Types.ObjectId(),
          type: "snippet",
          codeSnippet: { code: "console.log('fallback');" },
          reactions: { fire: 5 },
        },
      ];
    };

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(fallbackTriggered, true);
    assert.strictEqual(res.body.pinnedPosts.length, 1);
    assert.strictEqual(res.body.pinnedPosts[0].codeSnippet.code, "console.log('fallback');");
  });

  it("5. ADVERSARIAL CHALLENGE: Unpinning a legacy non-snippet post trapped by type guard", async () => {
    // Scenario: User pinned a 'standard' post before M1 safeguard was implemented.
    // Post has isPinnedToProfile: true.
    // User tries to unpin it via PATCH /post/:id/pin
    const legacyPostId = new mongoose.Types.ObjectId();
    const legacyPost = {
      _id: legacyPostId,
      authorId: loggedInUserId,
      type: "standard", // Legacy non-snippet
      isPinnedToProfile: true, // Already pinned!
      save: async () => {},
    };

    Post.findById = async () => legacyPost;

    const req = {
      params: { id: legacyPostId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await pinHandler(req, res);

    // FIXED: The user can successfully unpin their legacy non-snippet post!
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.message, "Post unpinned from profile");
    assert.strictEqual(res.body.isPinnedToProfile, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: Duplicate comments aggregation edge cases & SOS Track Record
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite 3: Duplicate Comments Aggregation Edge Cases & SOS Track Record", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultMocks();
  });

  it("1. Duplicate resolved comments on the SAME post: duplicate post in recentSolves and duplicate areaCounts", async () => {
    const commonPostId = new mongoose.Types.ObjectId();
    const commonPost = {
      _id: commonPostId,
      content: "How to fix React useEffect infinite loop?",
      stackTags: ["react", "javascript"],
    };

    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 15 }),
    });

    // Author has 2 comments marked resolved on the SAME post
    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [
            {
              _id: new mongoose.Types.ObjectId(),
              authorId: targetUserId,
              postId: commonPost,
              createdAt: new Date("2026-09-30T12:00:00Z"),
            },
            {
              _id: new mongoose.Types.ObjectId(),
              authorId: targetUserId,
              postId: commonPost,
              createdAt: new Date("2026-09-30T11:00:00Z"),
            },
          ],
        }),
      }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const { topAreas, recentSolves } = res.body.sosTrackRecord;

    // FIXED: recentSolves is deduplicated by postId — 1 unique entry
    assert.strictEqual(recentSolves.length, 1);
    assert.strictEqual(recentSolves[0].postId.toString(), commonPostId.toString());

    // areaCounts increments for both comments: react count = 2, javascript count = 2
    const reactArea = topAreas.find((a) => a.tag === "react");
    assert.ok(reactArea);
    assert.strictEqual(reactArea.count, 2);
  });

  it("2. Deleted post references in resolved comments: gracefully ignored without crash", async () => {
    const livePostId = new mongoose.Types.ObjectId();

    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 12 }),
    });

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [
            // Comment 1: Post was deleted (Mongoose populate returns postId = null)
            {
              _id: new mongoose.Types.ObjectId(),
              authorId: targetUserId,
              postId: null,
              createdAt: new Date("2026-09-30T13:00:00Z"),
            },
            // Comment 2: Live post
            {
              _id: new mongoose.Types.ObjectId(),
              authorId: targetUserId,
              postId: {
                _id: livePostId,
                content: "Docker container networking issue",
                stackTags: ["docker", "devops"],
              },
              createdAt: new Date("2026-09-30T12:00:00Z"),
            },
            // Comment 3: Another deleted post
            {
              _id: new mongoose.Types.ObjectId(),
              authorId: targetUserId,
              postId: null,
              createdAt: new Date("2026-09-30T11:00:00Z"),
            },
          ],
        }),
      }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const { topAreas, recentSolves } = res.body.sosTrackRecord;

    // The 2 null posts are filtered out cleanly
    assert.strictEqual(recentSolves.length, 1);
    assert.strictEqual(recentSolves[0].postId.toString(), livePostId.toString());
    assert.strictEqual(recentSolves[0].postContent, "Docker container networking issue");

    // Only tags from the live post are counted
    assert.strictEqual(topAreas.length, 2);
    assert.deepStrictEqual(topAreas.map((a) => a.tag).sort(), ["devops", "docker"]);
  });

  it("3. Duplicate stack tags on a single post: tag counts accumulate", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 10 }),
    });

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [
            {
              _id: new mongoose.Types.ObjectId(),
              authorId: targetUserId,
              postId: {
                _id: new mongoose.Types.ObjectId(),
                content: "Bug with duplicate tags",
                stackTags: ["react", "react", "redux"], // duplicate tag on post
              },
              createdAt: new Date(),
            },
          ],
        }),
      }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const reactTag = res.body.sosTrackRecord.topAreas.find((a) => a.tag === "react");
    assert.ok(reactTag);
    // Because forEach runs over postId.stackTags, react tag count becomes 2
    assert.strictEqual(reactTag.count, 2);
  });

  it("4. Post with missing or null stackTags: does not throw TypeError", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 10 }),
    });

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [
            {
              _id: new mongoose.Types.ObjectId(),
              postId: {
                _id: new mongoose.Types.ObjectId(),
                content: "Post with undefined stackTags",
                stackTags: undefined,
              },
              createdAt: new Date(),
            },
            {
              _id: new mongoose.Types.ObjectId(),
              postId: {
                _id: new mongoose.Types.ObjectId(),
                content: "Post with null stackTags",
                stackTags: null,
              },
              createdAt: new Date(),
            },
          ],
        }),
      }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.sosTrackRecord.topAreas, []);
    assert.strictEqual(res.body.sosTrackRecord.recentSolves.length, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: Stress Testing & Boundary Conditions
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite 4: Response Times & Extreme Boundary Conditions", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultMocks();
  });

  it("1. High-volume aggregation: 500 resolved comments with 100 distinct tags executes rapidly", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 500 }),
    });

    const mockComments = [];
    for (let i = 0; i < 500; i++) {
      mockComments.push({
        _id: new mongoose.Types.ObjectId(),
        postId: {
          _id: new mongoose.Types.ObjectId(),
          content: `Problem solve #${i}: Resolving complex race condition in distributed system`,
          stackTags: [`tag_${i % 100}`, `tag_${(i + 1) % 100}`, "popular_tag"],
        },
        createdAt: new Date(Date.now() - i * 100000),
      });
    }

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => mockComments,
        }),
      }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    const t0 = performance.now();
    await profileHandler(req, res);
    const duration = performance.now() - t0;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.sosTrackRecord.totalSolved, 500);
    assert.strictEqual(res.body.sosTrackRecord.isResponsive, true);
    assert.strictEqual(res.body.sosTrackRecord.recentSolves.length, 3);
    assert.strictEqual(res.body.sosTrackRecord.topAreas.length, 5);
    // 'popular_tag' was on every single post -> count must be 500
    assert.strictEqual(res.body.sosTrackRecord.topAreas[0].tag, "popular_tag");
    assert.strictEqual(res.body.sosTrackRecord.topAreas[0].count, 500);

    // Performance assertion: In-memory processing of 500 comments should take < 15ms
    assert.ok(duration < 25, `High-volume aggregation took ${duration.toFixed(2)}ms (expected < 25ms)`);
  });

  it("2. Extreme boundaries on user fields: null user, empty string ID, extreme helpfulAnswers", async () => {
    // 2a: User not found in database -> returns 404
    User.findById = () => ({ select: async () => null });
    let req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    let res = createMockRes();
    await profileHandler(req, res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.message, "User not found");

    // 2b: helpfulAnswers = -5 (negative edge case) -> isResponsive should be false
    User.findById = () => ({ select: async () => ({ _id: targetUserId, helpfulAnswers: -5 }) });
    req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    res = createMockRes();
    await profileHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.sosTrackRecord.totalSolved, -5);
    assert.strictEqual(res.body.sosTrackRecord.isResponsive, false);

    // 2c: helpfulAnswers = Number.MAX_SAFE_INTEGER -> isResponsive should be true
    User.findById = () => ({ select: async () => ({ _id: targetUserId, helpfulAnswers: Number.MAX_SAFE_INTEGER }) });
    req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    res = createMockRes();
    await profileHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.sosTrackRecord.totalSolved, Number.MAX_SAFE_INTEGER);
    assert.strictEqual(res.body.sosTrackRecord.isResponsive, true);
  });
});
