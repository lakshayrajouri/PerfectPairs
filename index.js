import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt"
import session from "express-session";

const app = express();
const { Pool } = pg;

// Setting up database connection pool
const pool = new Pool({
    user: 'postgres',    // Replace with your PostgreSQL username
    host: 'localhost',        // Replace with your database host
    database: 'PerfectPairs_db', // Replace with your database name
    password: '12345',    // Replace with your PostgreSQL password
    port: 5432,               // Default PostgreSQL port
});

//middleware
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

//setting up session
app.use(session({
    secret: 'your_secret_key', // Secret key for signing the session ID cookie
    resave: false,
    saveUninitialized: true
}));

app.set("view engine", 'ejs');

// Authentication middleware to check if user is logged in
function isAuthenticated(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
}

//middleware to check if the profile is completed by the user
async function checkProfileCompletion(req, res, next) {
    const userId = req.session.userId;

    if (!userId) {
        return res.redirect('/login');
    }

    // Check if profile exists
    const profile = await pool.query(
        'SELECT * FROM user_profile WHERE user_id = $1',
        [userId]
    );

    if (profile.rows.length === 0) {
        return res.redirect('/complete-profile');
    }

    next();
}
//middleware to protect admin routes
function isAdmin(req, res, next) {
    if (!req.session.adminId) {
        return res.redirect('/admin-login');
    }
    next();
}


//routes

// console.log(await pool.query('select * from matches'));

//home route
app.get('/', (req, res) => {
    // If user is logged in, redirect to the main dashboard
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    // Otherwise, show the welcome page
    res.render('index.ejs');
});

//registration Route
app.get("/register", (req, res) => {
    res.render('register');
})
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3)', [username, email, hashedPassword]);
    res.redirect('/login');
});

//Login Route
app.get("/login", (req, res) => {
    res.render('login');
})
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length > 0) {
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            req.session.userId = user.id;
            return res.redirect('/');
        }
    }
    res.redirect('/dashboard');
});
// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

//complete profile route
app.get('/complete-profile', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;

    // Check if the profile already exists
    const profile = await pool.query(
        'SELECT * FROM user_profile WHERE user_id = $1',
        [userId]
    );
    if (profile.rows.length > 0) {
        return res.redirect('/dashboard'); // Redirect if profile already completed
    }
    res.render('complete-profile');
});
app.post('/complete-profile', isAuthenticated, async (req, res) => {
    const { full_name, age, gender, bio, hobbies, location } = req.body;
    const userId = req.session.userId;

    try {
        // Insert user profile into the database
        await pool.query(
            `INSERT INTO user_profile 
        (user_id, full_name, age, gender, bio, hobbies, location) 
        VALUES ($1, $2, $3, $4, $5, $6::text[], $7)`,
            [userId, full_name, age, gender, bio, hobbies.split(','), location]
        );

        res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error completing profile.');
    }
});

// Dashboard route (requires authentication)
app.get('/dashboard', isAuthenticated, checkProfileCompletion, async (req, res) => {
    const userId = req.session.userId;

    // Get users to exclude: those with pending/accepted match requests or who are already match
    const excludedUsers = await pool.query(
        `
        SELECT DISTINCT id FROM users
        WHERE id IN (
          SELECT receiver_id FROM match_requests WHERE sender_id = $1
          UNION
          SELECT sender_id FROM match_requests WHERE receiver_id = $1
          UNION
          SELECT match_id FROM matches WHERE user_id = $1
        )
        `,
        [userId]
    );

    const excludedIds = excludedUsers.rows.map(row => row.id);

    // Fetch all users except excluded ones
    const users = await pool.query(
        `
        SELECT * FROM users
        WHERE id != $1 AND id != ALL($2::int[])
        `,
        [userId, excludedIds]
    );

    res.render('dashboard', { users: users.rows });
});

// Profile Edit Route (Only accessible if logged in)
app.get('/edit-my-profile', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;

    try {
        // Fetch the user's profile
        const result = await pool.query(
            'SELECT * FROM user_profile WHERE user_id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.redirect('/complete-profile'); // Redirect if profile doesn't exist
        }

        res.render('edit-my-profile', { profile: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading profile.');
    }
});
app.post('/edit-my-profile', isAuthenticated, async (req, res) => {
    const { full_name, age, gender, bio, hobbies, location } = req.body;
    const userId = req.session.userId;

    try {
        // Update the user's profile in the database
        await pool.query(
            `
        UPDATE user_profile 
        SET full_name = $1, age = $2, gender = $3, bio = $4, hobbies = $5::text[], location = $6
        WHERE user_id = $7
        `,
            [full_name, age, gender, bio, hobbies.split(','), location, userId]
        );

        res.redirect('/dashboard'); // Redirect to dashboard after update
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating profile.');
    }
});


// Send Match Request
app.post('/send-match-request', isAuthenticated, checkProfileCompletion, async (req, res) => {
    const { receiverId } = req.body;
    const senderId = req.session.userId;

    await pool.query('INSERT INTO match_requests (sender_id, receiver_id) VALUES ($1, $2)', [senderId, receiverId]);
    res.redirect('/');
});

// View Match Requests
app.get('/matches-request', isAuthenticated, async (req, res) => {
    const receivedRequests = await pool.query('SELECT * FROM match_requests WHERE receiver_id = $1 AND status = $2', [req.session.userId, 'pending']);
    const sentRequests = await pool.query('SELECT * FROM match_requests WHERE sender_id = $1 AND status = $2', [req.session.userId, 'pending']);

    res.render('matches-request', { receivedRequests: receivedRequests.rows, sentRequests: sentRequests.rows });
});
// Accept or Reject Match Request
app.post('/update-match-request', isAuthenticated, async (req, res) => {
    const { requestId, action } = req.body;
    const status = action === 'accept' ? 'accepted' : 'rejected';

    await pool.query('UPDATE match_requests SET status = $1 WHERE id = $2 AND receiver_id = $3', [status, requestId, req.session.userId]);
    res.redirect('/matches-request');
});

app.get('/matches', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;

    try {
        // Fetch users' full names and IDs
        const matches = await pool.query(
            `
        SELECT 
          up.user_id AS matches,
          up.full_name 
        FROM 
          matches m
        JOIN 
          user_profile up
        ON 
          m.match_id = up.user_id
        WHERE 
          m.user_id = $1
        `,
            [userId]
        );

        res.render('matches', { matches: matches.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading matches.');
    }
});

app.get('/profile/:userId', isAuthenticated, async (req, res) => {
    const userId = req.session.userId; // Logged-in user's ID
    const profileUserId = req.params.userId; // Profile owner's ID

    try {
        // Fetch profile details
        const profileResult = await pool.query(
            'SELECT * FROM user_profile WHERE user_id = $1',
            [profileUserId]
        );

        if (profileResult.rows.length === 0) {
            return res.status(404).send('Profile not found.');
        }

        const profile = profileResult.rows[0];

        // Check if the users are matched
        const isMatch = await pool.query(
            `
        SELECT * 
        FROM matches 
        WHERE (user_id = $1 AND match_id = $2)
        `,
            [userId, profileUserId]
        );

        const matchStatus = isMatch.rows.length > 0 ? 'match' : 'not_match';

        res.render('profile', {
            profile,
            matchStatus,
            userId,
            profileUserId,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching profile.');
    }
});

app.get('/messages', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;

    try {
        // Fetch messages received by the user
        const receivedMessages = await pool.query(
            `
        SELECT 
          m.id, 
          m.message, 
          m.sent_at, 
          up.full_name AS sender_name 
        FROM 
          messages m
        JOIN 
          user_profile up 
        ON 
          m.sender_id = up.user_id
        WHERE 
          m.receiver_id = $1
        ORDER BY 
          m.sent_at DESC
        `,
            [userId]
        );

        res.render('messages', { receivedMessages: receivedMessages.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading messages.');
    }
});

app.get('/sent-messages', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;

    try {
        // Fetch messages sent by the user
        const sentMessages = await pool.query(
            `
        SELECT 
          m.id, 
          m.message, 
          m.sent_at, 
          up.full_name AS receiver_name 
        FROM 
          messages m
        JOIN 
          user_profile up 
        ON 
          m.receiver_id = up.user_id
        WHERE 
          m.sender_id = $1
        ORDER BY 
          m.sent_at DESC
        `,
            [userId]
        );

        res.render('sent-messages', { sentMessages: sentMessages.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading sent messages.');
    }
});
app.post('/send-message', isAuthenticated, async (req, res) => {
    const { receiverId, message } = req.body;
    const senderId = req.session.userId;

    try {
        // Verify that the users are matched
        const isMatch = await pool.query(
            `
        SELECT * 
        FROM matches 
        WHERE (user_id = $1 AND match_id = $2)
        `,
            [senderId, receiverId]
        );

        if (isMatch.rows.length === 0) {
            return res.status(403).send('You can only message your matches.');
        }

        // Insert the message
        await pool.query(
            `
        INSERT INTO messages (sender_id, receiver_id, message) 
        VALUES ($1, $2, $3)
        `,
            [senderId, receiverId, message]
        );

        res.redirect(`/profile/${receiverId}`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error sending message.');
    }
});

app.post('/report-user/:reportedId', isAuthenticated, async (req, res) => {
    const reporterId = req.session.userId;
    const reportedId = req.params.reportedId;
    const { reason, additional_info } = req.body;

    try {
        // Insert the report into the database
        await pool.query(
            `
        INSERT INTO reports (reporter_id, reported_id, reason, additional_info)
        VALUES ($1, $2, $3, $4)
        `,
            [reporterId, reportedId, reason, additional_info || null]
        );

        res.redirect(`/profile/${reportedId}`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error reporting user.');
    }
});

app.get('/admin-login', (req, res) => {
    res.render('admin-login');
});
app.post('/admin-login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Verify admin credentials
        const adminResult = await pool.query(
            'SELECT * FROM admins WHERE username = $1',
            [username]
        );

        if (adminResult.rows.length === 0) {
            return res.status(401).send('Invalid admin credentials.');
        }

        const admin = adminResult.rows[0];
        const validPassword = await bcrypt.compare(password, admin.password);

        if (!validPassword) {
            return res.status(401).send('Invalid admin credentials.');
        }

        // Store admin ID in session
        req.session.adminId = admin.id;
        res.redirect('/admin-dashboard');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error logging in as admin.');
    }
});


// Example of protecting the admin dashboard
app.get('/admin-dashboard', isAdmin, async (req, res) => {
    try {
        const reports = await pool.query(
            `
        SELECT 
          r.id, 
          r.reason, 
          r.additional_info, 
          r.status, 
          r.reported_at, 
          rp.full_name AS reporter_name, 
          up.full_name AS reported_name
        FROM 
          reports r
        JOIN 
          user_profile rp ON r.reporter_id = rp.user_id
        JOIN 
          user_profile up ON r.reported_id = up.user_id
        ORDER BY 
          r.reported_at DESC
        `
        );

        res.render('admin-dashboard', { reports: reports.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading admin dashboard.');
    }
});


app.get('/resolve-report/:id', async (req, res) => {
    if (!req.session.adminId) {
        return res.redirect('/login');
    }

    try {
        await pool.query(
            'UPDATE reports SET status = $1 WHERE id = $2',
            ['Resolved', req.params.id]
        );
        res.redirect('/admin-dashboard');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error resolving report.');
    }
});

app.get('/dismiss-report/:id', async (req, res) => {
    if (!req.session.adminId) {
        return res.redirect('/login');
    }

    try {
        await pool.query(
            'UPDATE reports SET status = $1 WHERE id = $2',
            ['Dismissed', req.params.id]
        );
        res.redirect('/admin-dashboard');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error dismissing report.');
    }
});

app.get('/admin-logout', (req, res) => {
    if (req.session.adminId) {
        req.session.destroy(err => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error logging out.');
            }
            res.redirect('/admin-login');
        });
    } else {
        res.redirect('/admin-login');
    }
});


app.listen(3000, () => {
    console.log('Server is running on port 3000');
});