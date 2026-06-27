from django.urls import path

from . import views

urlpatterns = [
    path("products/", views.list_products, name="product-list"),
    path("products/<int:pk>/", views.ProductDetail.as_view(), name="product-detail"),
]
