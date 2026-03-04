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
);

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
);
