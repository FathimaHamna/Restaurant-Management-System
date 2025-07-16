const express = require("express");
const router = express.Router();
const orderController = require("../app/api/controllers/orderController");

router.get("/", orderController.getAll);
router.post("/", orderController.create);
router.get("/:id", orderController.getById);
router.delete("/:id", orderController.removeById);
module.exports = router;
