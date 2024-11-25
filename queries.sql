--registered users 
CREATE TABLE users(
	id SERIAL PRIMARY KEY,
	username VARCHAR(50) NOT NULL unique,
	email VARCHAR(50) NOT NULL,
	password VARCHAR(255) NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

--user profile table
CREATE TABLE user_profile (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  profilePhoto varchar(50),
  age INT NOT NULL,
  gender VARCHAR(50) NOT NULL,
  bio TEXT,
  location VARCHAR(255),
  hobbies TEXT
);

--admins table
CREATE TABLE admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL
);


--match requests table
CREATE TABLE match_requests (
  id SERIAL PRIMARY KEY,
  sender_id INT REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sender_id, receiver_id)
);

--sent/receieved messages table
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_id INT REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

--reports table
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  reporter_id INT REFERENCES users(id) ON DELETE CASCADE,
  reported_id INT REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(255) NOT NULL,
  additional_info TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

--joining users table to create a new match
CREATE VIEW matches AS
SELECT
  sender_id AS user_id,
  receiver_id AS match_id
FROM
  match_requests
WHERE
  status = 'accepted'
UNION
SELECT
  receiver_id AS user_id,
  sender_id AS match_id
FROM
  match_requests
WHERE
  status = 'accepted';