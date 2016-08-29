//index.js from https://github.com/rmistry75/Bounce
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var multer = require('multer');
var mysql = require('mysql');
var fs = require('fs');
var https = require('https');
var config = require('./config');
var Stripe = require('stripe');

https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, app).listen(443);

// Twilio SMS client 
var twilioClient = require('twilio')(config.twilioAccountSID, config.twilioAuthToken); 
 
// Storing invoice PDFs 
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'invoice')
  },
  filename: function (req, file, cb) {
    cb(null, req.body.showID + '-' + req.body.phoneNumber.replace(/[^\d]/g, '') + '.pdf') // phone number should only have digits
  }
})
 
var upload = multer({ storage: storage })

// MySQL DB connection 
var con = mysql.createConnection({
  host: config.mysqlHost,
  user: config.mysqlUser,
  password: config.mysqlPassword,
  database: config.mysqlDatabase
});

con.connect(function(err){
  if(err){
    console.log('Error connecting to Db');
    console.error('error connecting: ' + err.stack);
    return;
  }
  console.log('DB connection established');
});

// for client (horseshowtime) posting an Invoice via multi-part/form data
app.post('/invoice', upload.single('invoicePDF'), function(req, res, next) {
  console.log(req.body);
  phoneNumber = req.body.phoneNumber.replace(/[^\d]/g, '');  // phone number should only have digits
  
  var invoice = {};
  invoice['ShowID'] = req.body.showID;
  invoice['PersonName'] = req.body.name;
  invoice['BackNumber'] = req.body.backNumber;
  invoice['PhoneNumber'] = phoneNumber; 
  invoice['InvoiceTotal'] = req.body.invoiceTotal;
  invoice['InvoiceFilePath'] = req.file.path;
 
  con.query('INSERT INTO Invoices SET ?', invoice, function(err){
    if(err){
      console.error('query error: ' + err.stack);
      res.send(err.stack);
    }
    else
    {
      console.log("success");
      res.send("success");
     
      // send an SMS to tell rider invoice is ready for payment
      twilioClient.messages.create({ 
        to: phoneNumber, 
        from: "+14242887259", 
        body: "Message from Bounce",   
      }, function(err, message) { 
        if(err){
          console.log(err);
        } else {
          console.log(message.sid);
        }
      }); 
    }
  });
});

app.use(bodyParser.json()); // need to set this before can parse JSON http request

app.put('/invoice', function (req, res) {
  console.log(req.body);
  con.query('UPDATE Invoices SET PaidStatus = ? WHERE ShowID = ? AND PhoneNumber = ?', [req.body.paidStatus, req.body.showID, req.body.phoneNumber], function(err, result) {

    if(err){
      console.error('query error: ' + err.stack);
      res.send(err.stack);
    }
    else
    {
      console.log("success");
      res.send("success");
    }
  });
});
 
app.get('/invoices', function (req, res) {
  //var id = req.query.phoneNumber;
  con.query("SELECT s.ShowID, s.ShowName, s.ShowDate, s.AccountNumber, s.RoutingNumber, i.PersonName, i.BackNumber, i.PhoneNumber, i.InvoiceTotal, i.PaidStatus,  i.InvoiceFilePath FROM Shows s, Invoices i WHERE s.ShowID = i.ShowID AND i.PhoneNumber = '" + req.query.phoneNumber + "'", function(err, rows, fields) {
    if (!err){
      console.log('Query results: ', rows);
      res.send(rows);
    }    
    else
    {
      console.error('query error: ' + err.stack);
      res.send(err.stack);
    }
  });
});

// this allows clients to HTTP GET pdfs from /invoice/xxx
app.use('/invoice', express.static('invoice'));

app.post('/show', function (req, res) {
  console.log(req.body);

  var show = {};
  show['ShowID'] = req.body.showID;
  show['ShowName'] = req.body.showName;
  show['ShowDate'] = req.body.showDate;
  con.query('INSERT INTO Shows SET ?', show, function(err){
    if(err){
      console.error('query error: ' + err.stack);
      res.send(err.stack);
    }
    else
    {
      console.log("success");
      res.send("success");
    }
  });
});

app.get("/stripe", function(req, res) {

  var authCode = req.query.code;

  // Make /oauth/token endpoint POST request

  var request = require('request'); 
  request.post({
    url: "https://connect.stripe.com/oauth/token",
    form: {
      grant_type: "authorization_code",
      client_id: config.StripeOAuthClientID,
      code: authCode,
      client_secret: config.StripeOAuthClientSecret 
    }
  }, function(err, r, body) {
 
    console.log(body); 
    var accessToken = JSON.parse(body).access_token;

    // Do something with your accessToken (save to DB)

    // For demo"s sake, output in response:
    //res.send({ "Your Token": accessToken });
    res.send(body);
  });
});

app.post('/pay', function (req, res) { //Pay to 'account' with payment token 'id'
  var source = req.body.source;
  if(!source) {
    res.status(400).send('Missing Payment Source!');
    return;
  }
  var account = req.body.account;
  if(!account) {
    res.status(400).send('Missing Destination Account!');
    return;
  }

  var amount = req.body.amount;
  if(!amount) {
    res.status(400).send('Missing  Amount!');
    return;
  }

  var currency = req.body.currency;
  if(!currency) {
    res.status(400).send('Missing  Currency!');
    return;
  }

  //Payment
  var myStripe = Stripe(config.StripeOAuthClientSecret);
  myStripe.charges.create({
    amount: amount,
    currency: currency,
    source: source,
    destination: account
  }, function (err, charges) {
    if(err){
      res.status(500).json(err);
    } else {
      res.json(charges);
    }
  });
});

/*
app.listen(80, function () {
  console.log('Bounce node.js server listening on port 80');
});
*/
