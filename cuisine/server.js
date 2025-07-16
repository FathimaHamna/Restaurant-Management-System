const express = require("express");
const logger = require("morgan");
const dishRoutes = require("./routes/dishRoutes");
const bodyParser = require("body-parser");
const mongoose = require("./config/database");
const { createChannel, publishMessage } = require("./app/publisher");
const startConsumer = require("./app/consumer");
const Consul = require("consul");

const app = express();

const serviceName = "cuisine";
const servicePort = process.env.PORT || 3000;
const serviceId = `${serviceName}-${process.pid}`;

// Configure Consul client
const consul = new Consul({
  host: process.env.CONSUL_HOST || "consul",
  port: 8500,
});

const start = () => {
  mongoose.connection.on(
    "error",
    console.error.bind(console, "MongoDB connection error:")
  );

  app.use(logger("dev"));
  app.use(bodyParser.json());

  // Health check
  app.get("/health", (req, res) => res.send("OK"));

  // Root
  app.get("/", function (req, res) {
    res.json({ tutorial: "Build REST API with node.js" });
  });

  // Routes
  app.use("/dish", dishRoutes);

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
    console.log(err);
    if (err.status === 404) res.status(404).json({ message: "Not found" });
    else res.status(500).json({ message: "Something looks wrong :( !!!" });
  });

  publishMessage("cuisine.running", "Cuisine running");
  startConsumer();

  app.listen(servicePort, "0.0.0.0", function () {
    console.log(`Cuisine service running on port ${servicePort}`);

    // Register with Consul
    consul.agent.service.register(
      {
        id: serviceId,
        name: serviceName,
        address: serviceName, // should match container_name
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
          console.error("Failed to register Cuisine service with Consul:", err);
        } else {
          console.log("Cuisine service registered with Consul");
        }
      }
    );
  });

  // Deregister on shutdown
  const cleanup = () => {
    consul.agent.service.deregister(serviceId, () => {
      console.log("Deregistered Cuisine service from Consul");
      process.exit();
    });
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
};

createChannel(start);
