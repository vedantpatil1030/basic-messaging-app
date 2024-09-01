const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const http = require('http');
const socketIo = require('socket.io');
const User = require('./models/user');
const Message = require('./models/message');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/chatApp', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true,
}));

// Check if user is authenticated
function checkAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Routes
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = new User({ username, password });
    await user.save();
    req.session.userId = user._id;
    res.redirect('/');
  } catch (error) {
    res.render('register', { error: 'Username already exists' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (user && await user.comparePassword(password)) {
    req.session.userId = user._id;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Invalid username or password' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', checkAuth, async (req, res) => {
  try {
    // Fetch all users except the current user
    const users = await User.find({ _id: { $ne: req.session.userId } });
    res.render('index', { users });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching users');
  }
});

app.get('/chat/:userId', checkAuth, async (req, res) => {
  try {
    const currentUser = req.session.userId;
    const receiver = await User.findById(req.params.userId); // Fetch receiver's details

    if (!receiver) {
      return res.status(404).send('User not found');
    }

    const messages = await Message.find({
      $or: [
        { sender: currentUser, receiver: receiver._id },
        { sender: receiver._id, receiver: currentUser }
      ]
    }).populate('sender receiver');
    
    // Pass receiver's username to the template
    res.render('chat', {
      messages,
      receiverId: receiver._id,  // Keep the receiverId for referencing
      receiverUsername: receiver.username,  // Pass receiver's username
      currentUser: currentUser  // Keep the current user's ID
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading chat');
  }
});



io.on('connection', (socket) => {
  console.log('A user connected');

  // Listen for the user joining a specific chat room
  socket.on('join room', ({ currentUser, receiver }) => {
      const roomId = [currentUser, receiver].sort().join('_');
      socket.join(roomId);
  });

  socket.on('chat message', async (data) => {
    try {
        // Save the message to the database
        const message = new Message(data);
        await message.save();

        // Retrieve sender's username for the message
        const sender = await User.findById(data.sender);
        const roomId = [data.sender, data.receiver].sort().join('_');

        // Emit the message to the sender for confirmation
        socket.emit('message confirmation', {
            ...data,
            sender: 'You', // Use "You" or any other label for the sender themselves
            content: `<strong>You:</strong> ${data.content}`
        });

        // Emit the message to the room for the receiver
        io.to(roomId).emit('chat message', {
            ...data,
            sender: sender.username, // Send the username to the receiver
            content: `<strong>${sender.username}:</strong> ${data.content}`
        });
    } catch (error) {
        console.error('Error handling chat message:', error);
    }
});


  socket.on('disconnect', () => {
      console.log('User disconnected');
  });
});

// Start the server
server.listen(3600, () => {
  console.log('Server is running on http://localhost:3600');
});


