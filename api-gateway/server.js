const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// Proxy for Stock Service
app.use("/stock", createProxyMiddleware({
  target: "http://localhost:3003/stock",
  changeOrigin: true,
  pathRewrite: { "^/stock": "" },
}));

// Proxy for Order Service
app.use("/order", createProxyMiddleware({
  target: "http://localhost:3000/order",
  changeOrigin: true,
  pathRewrite: { "^/order": "" },
}));

// Proxy for Dish/Cuisine Service
app.use("/dish", createProxyMiddleware({
  target: "http://localhost:3002/dish",
  changeOrigin: true,
  pathRewrite: { "^/dish": "" },
}));

app.listen(4000, () => {
  console.log("THIS is the gateway code actually running");
  console.log("API Gateway running at http://localhost:4000");
});
