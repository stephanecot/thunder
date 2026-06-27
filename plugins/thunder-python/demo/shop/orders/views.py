from flask import Blueprint, request, jsonify

from .models import Order

bp = Blueprint("orders", __name__)


@bp.route("/orders", methods=["POST"])
def place_order():
    data = request.get_json()
    if data["amount"] <= 0:
        return jsonify({"error": "amount must be positive"}), 400
    order = Order(id=0, user_id=data["user_id"], amount=data["amount"])
    return jsonify(order.__dict__), 201


@bp.route("/orders/by-user/<int:user_id>", methods=["GET"])
def list_orders(user_id):
    return jsonify([])
