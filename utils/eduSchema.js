const db = require('../db');

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    db.query(sql, params, (err, results) => {
      if (err) {
        console.error('DB QUERY ERROR:', {
          code: err.code,
          errno: err.errno,
          sqlState: err.sqlState,
          message: err.message,
          durationMs: Date.now() - startedAt,
          sqlPreview: String(sql).replace(/\s+/g, ' ').trim().slice(0, 180),
          paramCount: Array.isArray(params) ? params.length : 0,
        });
        return reject(err);
      }

      resolve(results);
    });
  });
}

let schemaInitPromise = null;

async function ensureEduSchema() {
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('teacher', 'student') NOT NULL,
        department VARCHAR(120) DEFAULT NULL,
        institution VARCHAR(160) DEFAULT NULL,
        profile_pic_url VARCHAR(500) DEFAULT NULL,
        is_profile_public TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const profilePicColumnRows = await runQuery(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'edu_users'
         AND COLUMN_NAME = 'profile_pic_url'
       LIMIT 1`
    );

    if (!profilePicColumnRows.length) {
      await runQuery(`
        ALTER TABLE edu_users
        ADD COLUMN profile_pic_url VARCHAR(500) DEFAULT NULL
      `);
    }

    const profileVisibilityColumnRows = await runQuery(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'edu_users'
         AND COLUMN_NAME = 'is_profile_public'
       LIMIT 1`
    );

    if (!profileVisibilityColumnRows.length) {
      await runQuery(`
        ALTER TABLE edu_users
        ADD COLUMN is_profile_public TINYINT(1) NOT NULL DEFAULT 1
      `);
    }

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        content TEXT,
        media_url VARCHAR(500) DEFAULT NULL,
        privacy ENUM('public', 'friends', 'private') DEFAULT 'public',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_edu_posts_user FOREIGN KEY (user_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_post_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_edu_post_like (post_id, user_id),
        CONSTRAINT fk_edu_likes_post FOREIGN KEY (post_id) REFERENCES edu_posts(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_likes_user FOREIGN KEY (user_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        comment_text TEXT NOT NULL,
        parent_comment_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_edu_comments_post FOREIGN KEY (post_id) REFERENCES edu_posts(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_comments_user FOREIGN KEY (user_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES edu_comments(id) ON DELETE SET NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_shares (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        caption TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_edu_shares_post FOREIGN KEY (post_id) REFERENCES edu_posts(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_shares_user FOREIGN KEY (user_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_friend_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        status ENUM('pending', 'accepted', 'rejected', 'cancelled') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY uniq_edu_friend_request (sender_id, receiver_id),
        CONSTRAINT fk_edu_req_sender FOREIGN KEY (sender_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_req_receiver FOREIGN KEY (receiver_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_friendships (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user1_id INT NOT NULL,
        user2_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_edu_friend_pair (user1_id, user2_id),
        CONSTRAINT fk_edu_friend_user1 FOREIGN KEY (user1_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_friend_user2 FOREIGN KEY (user2_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_dm_conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user1_id INT NOT NULL,
        user2_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_edu_dm_pair (user1_id, user2_id),
        INDEX idx_edu_dm_user1 (user1_id),
        INDEX idx_edu_dm_user2 (user2_id),
        CONSTRAINT fk_edu_dm_conv_user1 FOREIGN KEY (user1_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_dm_conv_user2 FOREIGN KEY (user2_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_dm_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        message_text TEXT NOT NULL,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_edu_dm_messages_conversation (conversation_id, created_at),
        INDEX idx_edu_dm_messages_receiver (receiver_id, is_read, created_at),
        CONSTRAINT fk_edu_dm_messages_conversation FOREIGN KEY (conversation_id) REFERENCES edu_dm_conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_dm_messages_sender FOREIGN KEY (sender_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_dm_messages_receiver FOREIGN KEY (receiver_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS edu_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recipient_id INT NOT NULL,
        actor_id INT NULL,
        type ENUM('like', 'comment', 'share', 'friend_request') NOT NULL,
        entity_type ENUM('post', 'friend_request') NOT NULL,
        entity_id INT NOT NULL,
        message VARCHAR(255) NOT NULL,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_edu_notifications_recipient (recipient_id, is_read, created_at),
        CONSTRAINT fk_edu_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_edu_notifications_actor FOREIGN KEY (actor_id) REFERENCES edu_users(id) ON DELETE SET NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS meetings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(64) NOT NULL UNIQUE,
        title VARCHAR(255) DEFAULT NULL,
        host_user_id INT NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_meetings_host_user_id (host_user_id),
        INDEX idx_meetings_is_active (is_active),
        CONSTRAINT fk_meetings_host_user FOREIGN KEY (host_user_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS meeting_participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(64) NOT NULL,
        user_id INT NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        left_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_meeting_participants_room_id (room_id),
        INDEX idx_meeting_participants_user_id (user_id),
        INDEX idx_meeting_participants_active (room_id, left_at),
        CONSTRAINT fk_meeting_participants_room FOREIGN KEY (room_id) REFERENCES meetings(room_id) ON DELETE CASCADE,
        CONSTRAINT fk_meeting_participants_user FOREIGN KEY (user_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);
  })().catch((error) => {
    schemaInitPromise = null;
    throw error;
  });

  return schemaInitPromise;
}

module.exports = {
  runQuery,
  ensureEduSchema,
};

