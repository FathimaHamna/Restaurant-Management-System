const express = require("express");
const logger = require("morgan");
const stockRoutes = require("./routes/stockRoutes");
const {
  hasEnoughIngredients,
} = require("./app/api/controllers/stockController");
const bodyParser = require("body-parser");
const mongoose = require("./config/database"); // database configuration
const { createChannel, publishMessage } = require("./app/publisher");
const startConsumer = require("./app/consumer");
const Consul = require("consul");

const app = express();

const serviceName = "stock";
const servicePort = process.env.PORT || 3000;
const serviceId = `${serviceName}-${process.pid}`;

// Configure Consul client to connect to consul container by hostname
const consul = new Consul({
  host: process.env.CONSUL_HOST || "consul",
  port: 8500,
});

const start = () => {
  // MongoDB connection error handling
  mongoose.connection.on(
    "error",
    console.error.bind(console, "MongoDB connection error:")
  );

  app.use(logger("dev"));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  // Health check endpoint
  app.get("/health", (req, res) => res.send("OK"));

  // Root endpoint
  app.get("/", function (req, res) {
    res.json({ tutorial: "Build REST API with node.js" });
  });

  // Routes
  app.use("/stock", stockRoutes);

  // Favicon request
  app.get("/favicon.ico", function (req, res) {
    res.sendStatus(204);
  });

  // 404 handler
  app.use(function (req, res, next) {
    let err = new Error("Not Found");
    err.status = 404;
    next(err);
  });

  // Error handler
  app.use(function (err, req, res, next) {
    console.error(err);
    if (err.status === 404) res.status(404).json({ message: "Not found" });
    else res.status(500).json({ message: "Something looks wrong :( !!!" });
  });

  // Messaging and RabbitMQ
  publishMessage("stocks.running", "Stocks running");
  startConsumer();

  // Start server and register with Consul
  app.listen(servicePort, "0.0.0.0", function () {
    console.log(`Stock service running on port ${servicePort}`);

    // Register service with Consul
    consul.agent.service.register(
      {
        id: serviceId,
        name: serviceName,
        address: serviceName, // should match container name ('stock')
        port: parseInt(servicePort),
        check: {
          http: `http://${serviceName}:${servicePort}/health`,
          interval: "10s",
          timeout: "5s",
          deregistercriticalserviceafter: "1m",
        },
      },
      (err) => {
        if (err) {
          console.error("Failed to register Stock service with Consul:", err);
        } else {
          console.log("Registered Stock service with Consul");
        }
      }
    );
  });

  // Deregister on shutdown
  const cleanup = () => {
    consul.agent.service.deregister(serviceId, () => {
      console.log("Deregistered Stock service from Consul");
      process.exit();
    });
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
};

createChannel(start);
