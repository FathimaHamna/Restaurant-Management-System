const { v4: uuid } = require("uuid");
const { orderModel, orderState } = require("../models/order");
const { publishMessage } = require("../../publisher");

async function saveOrder(data) {
  if (!data || typeof data !== 'object') {
    // write to your logger instead of console in prod
    throw new Error('saveOrder: expected order object, received ' + JSON.stringify(data));
  }

  const orderDoc = new orderModel({
    _id:          data._id || uuid(),
    customer_id:  data.customer_id,
    dish_id:      data.dish_id,
    items:        data.items,
    total:        data.total,
    type:         data.type,
    released_on:  data.released_on ? new Date(data.released_on) : new Date(),
    state:        data.state ?? orderState.CREATED,
  });

  return orderDoc.save();
}

module.exports = {
  /* ──────────────── READ ──────────────── */

  getById(req, res, next) {
    console.log("getting order with id", req.params.id);
    orderModel.findById(req.params.id, (err, orderInfo) => {
      if (err) return next(err);
      if (!orderInfo) return res.status(404).json({ message: "Not found" });

      res.json({
        status: "success",
        message: "Order found!!!",
        data: { order: orderInfo },
      });
    });
  },

  getByIdV2(req, res, next) {
    console.log("getting order with id", req.params.id);
    orderModel.findById(req.params.id, (err, orderInfo) => {
      if (err) return next(err);
      if (!orderInfo) return res.status(404).json({ message: "Not found" });

      res.json({ order: orderInfo });
    });
  },

  getAll(req, res, next) {
    console.log("getting all orders");
    orderModel.find({}, (err, orders) => {
      if (err) return next(err);

      const ordersList = orders.map((o) => ({
        id: o._id,
        customer_id: o.customer_id,
        released_on: o.released_on,
        state: o.state,
        type: o.type,
      }));

      // res.json({
      //   status: "success",
      //   message: "Order list found!!!",
      //   data: { orders: ordersList },
      // });
      // Return only active orders
      orderModel.find(
        { state: { $ne: orderState.CANCELLED } },
        (err, orders) => {
          if (err) return next(err);
          res.json({
            status: "success",
            message: "Order list found!!!",
            data: { orders },
          });
        }
      );
    });
  },

  getAllV2(req, res, next) {
    console.log("getting all orders v2");
    orderModel.find({}, (err, orders) => {
      if (err) return next(err);

      const ordersList = orders.map((o) => ({
        id: o._id,
        customer_id: o.customer_id,
        released_on: o.released_on,
        state: o.state,
        type: o.type,
      }));

      res.json(ordersList);
    });
  },

  /* ──────────────── CREATE ──────────────── */

  /**
   * HTTP POST /order handler
   */
  async create(req, res, next) {
  try {
    // validate req.body...

    const saved = await saveOrder(req.body);

    try {
      publishMessage(
        "order.created",
        JSON.stringify({ event: "order_created", object: { order: saved } })
      );
    } catch (pubErr) {
      console.error("Error publishing message:", pubErr);
      // Optionally continue or handle error without crashing
    }

    res.json({
      status: "success",
      message: "Order added successfully!",
      data: saved,
    });
  } catch (err) {
    console.error("Error creating order:", err);
    if (typeof next === 'function') return next(err); 
    throw err;
  }
  },

  /**
 * Handler for RabbitMQ messages to create orders
 */
async createFromMessage(msg) {
  try {
    const payload = JSON.parse(msg.content.toString());

    const order = payload?.object?.order;
    if (!order || typeof order !== 'object') {
      console.error("Invalid message payload:", payload);
      return;
    }

    const saved = await saveOrder(order);
    console.log("Order saved from message:", saved._id);
  } catch (err) {
    console.error("Error processing order message:", err);
    // Don't let exceptions crash the consumer or app
  }
},

  /* ──────────────── STATE HELPERS ──────────────── */

  changeOrderState(id, state) {
    console.log("changing order", id, "to state", state);
    orderModel.findByIdAndUpdate(id, { state }, (err, doc) => {
      if (err) return console.warn("Failed to change state", err);
      if (!doc) console.log("Order with id", id, "not found");
    });
  },

  setOrderReady(message) {
    console.log("setting order", message.object.order._id, "ready");
    this.changeOrderState(message.object.order._id, orderState.READY);
  },

  setOrderPaid(order, customer) {
    orderModel.findById(order._id, (err, orderInfo) => {
      if (err) return console.log("error:", err);
      if (!orderInfo) return console.log("Order not found:", order._id);

      if (orderInfo.state === orderState.CANCELLED) {
        return console.log("order", order._id, "was cancelled");
      }

      this.changeOrderState(order._id, orderState.PAID);
      publishMessage(
        "order.confirmed",
        JSON.stringify({
          event: "order_confirmed",
          object: { order, customer },
        })
      );
    });
  },
  
  /* ──────────────── DELETE ──────────────── */

  // removeById(req, res, next) {
  //   console.log("removing order with id", req.params.id);
  //   orderModel.findById(req.params.id, (err, orderInfo) => {
  //     if (err) return next(err);
  //     if (!orderInfo) return res.status(404).json({ message: "Not found" });

  //     if (orderInfo.state !== orderState.CREATED) {
  //       return res.status(400).json({
  //         message: "Cannot cancel processing or processed orders",
  //       });
  //     }

  //     orderModel.findByIdAndUpdate(
  //       orderInfo._id,
  //       { state: orderState.CANCELLED },
  //       (err) => {
  //         if (err)
  //           return res
  //             .status(400)
  //             .json({ message: "Failed to cancel the order" });

  //         res.json({
  //           status: "success",
  //           message: `order ${orderInfo._id} cancelled with success`,
  //         });
  //       }
  //     );
  //   });
  // },

  /* ──────────────── DELETE (Soft Delete - Cancel Order) ──────────────── */

removeById(req, res, next) {
  console.log("removing order with id", req.params.id);

  orderModel.findById(req.params.id, (err, orderInfo) => {
    if (err) return next(err);
    if (!orderInfo) return res.status(404).json({ message: "Not found" });

    // Allow cancel only if order is in CREATED state
    if (orderInfo.state !== orderState.CREATED) {
      return res.status(400).json({
        message: "Cannot cancel processing or processed orders",
      });
    }

    // Update order state to CANCELLED (soft delete)
    orderModel.findByIdAndUpdate(
      orderInfo._id,
      { state: orderState.CANCELLED },
      (err) => {
        if (err)
          return res
            .status(400)
            .json({ message: "Failed to cancel the order" });

        res.json({
          status: "success",
          message: `order ${orderInfo._id} cancelled with success`,
        });
      }
    );
  });
},
};
