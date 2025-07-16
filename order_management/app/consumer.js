/* consumer.js */
const amqp = require("amqplib/callback_api");
const orderController = require("../app/api/controllers/orderController");
// Pull out the dedicated Rabbit handler (expects a Rabbit `msg`, not req/res/next)
const { createFromMessage } = require("../app/api/controllers/orderController");
const { orderState } = require("./api/models/order"); // adjust path if needed

// -----------------------------------------------------------------------------
// Main entry
// -----------------------------------------------------------------------------
const startConsumer = () => {
  const amqpURL = process.env.AMQP_URL;

  amqp.connect(amqpURL, (errConn, connection) => {
    if (errConn) throw errConn;

    connection.createChannel((errChan, channel) => {
      if (errChan) throw errChan;

      const exchange = `restaurant.${process.env.NODE_ENV}`;
      channel.assertExchange(exchange, "direct", { durable: false });

      const localUser = process.env.LOCAL_USER ? `${process.env.LOCAL_USER}.` : "";
      const queueName = `orders.management.${process.env.NODE_ENV}.${localUser}queue`;

      channel.assertQueue(queueName, { exclusive: false }, (_errQ, q) => {
        console.log(" [*] Waiting for logs. To exit press CTRL+C");

        // Bind all routing keys we care about
        [
          "order.created",
          "order.paid",
          "order.initialized",
          "order.refunded",
          "order.ready",
          "order.delivered",
        ].forEach((rk) => channel.bindQueue(q.queue, exchange, rk));

        // -------------------------------------------------------------------
        // Consume
        // -------------------------------------------------------------------
        channel.consume(
          q.queue,
          async (msg) => {
            try {
              const body = msg.content.toString();
              console.log(" [x] %s: '%s'", msg.fields.routingKey, body);

              await processMessage(JSON.parse(body), msg); // pass both forms
              channel.ack(msg); // ✅ success
            } catch (err) {
              console.error("could not process the message:", err);
              channel.nack(msg, false, false); // dead‑letter or drop
            }
          },
          { noAck: false } // we want manual ack/nack
        );
      });
    });
  });
};

// -----------------------------------------------------------------------------
// Message router
// -----------------------------------------------------------------------------
async function processMessage(message, rawMsg) {
  switch (message.event) {
    // ------------------------------------------------ order_created -------
    case "order_created":
      if (message?.object?.order?._id) {
        // Use the dedicated Rabbit handler
        await createFromMessage(rawMsg);
      } else {
        console.warn(
          "Consumer - No order._id provided on order_created event"
        );
      }
      break;

    // ------------------------------------------------ order_paid ----------
    case "order_paid":
      if (message?.object?.order?._id) {
        await orderController.setOrderPaid(
          message.object.order,
          message.object.customer
        );
      } else {
        console.warn("Consumer - No order._id on order_paid event");
      }
      break;

    // ------------------------------------------------ order_initialized ---
    case "order_initialized":
      if (message?.object?.order?._id) {
        await orderController.changeOrderState(
          message.object.order._id,
          orderState.INITIALIZED
        );
      } else {
        console.warn("Consumer - No order._id on order_initialized event");
      }
      break;

    // ------------------------------------------------ order_ready ---------
    case "order_ready":
      if (message?.object?.order?._id) {
        await orderController.setOrderReady(message);
      } else {
        console.warn("Consumer - No order._id on order_ready event");
      }
      break;

    // ------------------------------------------------ order_delivered -----
    case "order_delivered":
      if (message?.object?.order?._id) {
        await orderController.changeOrderState(
          message.object.order._id,
          orderState.COMPLETED
        );
      } else {
        console.warn("Consumer - No order._id on order_delivered event");
      }
      break;

    // ------------------------------------------------ order_refunded ------
    case "order_refunded":
      if (message?.object?.order?._id) {
        await orderController.changeOrderState(
          message.object.order._id,
          orderState.REFUNDED
        );
      } else {
        console.warn("Consumer - No order._id on order_refunded event");
      }
      break;

    // ------------------------------------------------ default -------------
    default:
      console.warn("Consumer - Unknown event:", message.event);
  }
}

module.exports = startConsumer;
