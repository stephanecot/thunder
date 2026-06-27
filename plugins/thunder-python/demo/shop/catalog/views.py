from django.http import JsonResponse
from django.views import View

from .models import Product


def list_products(request):
    products = Product.objects.filter(active=True)
    return JsonResponse({"count": products.count()})


class ProductDetail(View):
    def get(self, request, pk):
        product = Product.objects.get(pk=pk)
        return JsonResponse({"code": product.code, "name": product.name})
