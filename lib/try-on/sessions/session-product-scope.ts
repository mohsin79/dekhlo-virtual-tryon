export function sessionMatchesProductScope(
  session: { brand_id: string; product_id: string },
  product: { brandId: string; productId: string },
): boolean {
  return session.brand_id === product.brandId && session.product_id === product.productId;
}
