import os
import statistics
import uuid
from datetime import date
from urllib.parse import quote

import requests
from flask import Flask, jsonify, request, send_from_directory
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import secure_filename

from models import Client, Material, Session as DbSession, Work, WorkImage, init_db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

engine, Session = init_db("sqlite:///" + os.path.join(BASE_DIR, "data.db"))
DbSession.configure(bind=engine)

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024


def error(message, status=400):
    return jsonify({"error": message}), status


def serialize_work(work):
    return {
        "id": work.id,
        "name": work.name,
        "description": work.description or "",
        "service_name": work.service_name or "",
        "service_percentage": work.service_percentage if work.service_percentage is not None else 22.12,
        "start_date": work.start_date or work.scheduled_date,
        "end_date": work.end_date,
        "materials": [{"id": m.id, "name": m.name, "estimated_price": m.estimated_price, "quantity": m.quantity or 1} for m in work.materials],
        "images": [{"id": img.id, "filename": img.filename, "url": f"/uploads/{img.filename}"} for img in work.images],
    }


@app.errorhandler(413)
def too_large(_):
    return error("O conjunto de imagens excede o limite de 32 MB.", 413)


@app.route("/api/clients", methods=["GET", "POST"])
def clients():
    with Session() as session:
        if request.method == "GET":
            items = session.query(Client).order_by(Client.name).all()
            return jsonify([{"id": c.id, "name": c.name, "work_count": len(c.works)} for c in items])

        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        if len(name) < 2:
            return error("Informe um nome com pelo menos 2 caracteres.")
        if len(name) > 200:
            return error("O nome deve ter no maximo 200 caracteres.")
        client = Client(name=name)
        session.add(client)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            return error("Ja existe um cliente com esse nome.", 409)
        return jsonify({"id": client.id, "name": client.name, "work_count": 0}), 201


@app.route("/api/clients/<int:client_id>", methods=["DELETE"])
def delete_client(client_id):
    with Session() as session:
        client = session.get(Client, client_id)
        if not client:
            return error("Cliente nao encontrado.", 404)
        images = [img.filename for work in client.works for img in work.images]
        session.delete(client)
        session.commit()
        remove_uploads(images)
        return "", 204


@app.route("/api/clients/<int:client_id>/works", methods=["GET", "POST"])
def client_works(client_id):
    with Session() as session:
        client = session.get(Client, client_id)
        if not client:
            return error("Cliente nao encontrado.", 404)
        if request.method == "GET":
            works = session.query(Work).filter_by(client_id=client_id).order_by(Work.id.desc()).all()
            return jsonify([serialize_work(work) for work in works])

        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        description = str(body.get("description", "")).strip()
        service_name = str(body.get("service_name", "")).strip()
        start_date, end_date, date_error = validate_work_dates(body.get("start_date") or body.get("scheduled_date"), body.get("end_date"))
        if date_error:
            return error(date_error)
        try:
            service_percentage = max(0, min(float(body.get("service_percentage", 22.12)), 100))
        except (TypeError, ValueError):
            service_percentage = 22.12
        materials = body.get("materials", [])
        if len(name) < 2:
            return error("Informe o nome da obra.")
        if len(name) > 200 or len(description) > 5000:
            return error("Um dos campos excede o limite permitido.")
        if not isinstance(materials, list):
            return error("A lista de materiais e invalida.")

        work = Work(name=name, description=description, service_name=service_name[:200], service_percentage=service_percentage, start_date=start_date, end_date=end_date, client_id=client_id)
        session.add(work)
        for item in materials[:50]:
            material_name = str(item.get("name", "")).strip()
            if material_name:
                price = item.get("estimated_price")
                try:
                    quantity = max(0.01, min(float(item.get("quantity", 1)), 1000000))
                except (TypeError, ValueError):
                    quantity = 1
                work.materials.append(Material(name=material_name[:200], estimated_price=str(price)[:100] if price is not None else None, quantity=quantity))
        session.commit()
        return jsonify(serialize_work(work)), 201


@app.route("/api/works/<int:work_id>", methods=["PUT", "DELETE"])
def update_or_delete_work(work_id):
    with Session() as session:
        work = session.get(Work, work_id)
        if not work:
            return error("Obra nao encontrada.", 404)
        if request.method == "PUT":
            body = request.get_json(silent=True) or {}
            name = str(body.get("name", "")).strip()
            description = str(body.get("description", "")).strip()
            service_name = str(body.get("service_name", "")).strip()
            start_date, end_date, date_error = validate_work_dates(body.get("start_date") or body.get("scheduled_date"), body.get("end_date"))
            if date_error:
                return error(date_error)
            try:
                service_percentage = max(0, min(float(body.get("service_percentage", 22.12)), 100))
            except (TypeError, ValueError):
                service_percentage = 22.12
            materials = body.get("materials", [])
            if len(name) < 2:
                return error("Informe o nome da obra.")
            if len(name) > 200 or len(description) > 5000:
                return error("Um dos campos excede o limite permitido.")
            if not isinstance(materials, list):
                return error("A lista de materiais e invalida.")
            work.name = name
            work.description = description
            work.service_name = service_name[:200]
            work.service_percentage = service_percentage
            work.start_date = start_date
            work.end_date = end_date
            work.materials.clear()
            for item in materials[:50]:
                material_name = str(item.get("name", "")).strip()
                if material_name:
                    price = item.get("estimated_price")
                    try:
                        quantity = max(0.01, min(float(item.get("quantity", 1)), 1000000))
                    except (TypeError, ValueError):
                        quantity = 1
                    work.materials.append(Material(name=material_name[:200], estimated_price=str(price)[:100] if price is not None else None, quantity=quantity))
            session.commit()
            return jsonify(serialize_work(work))
        images = [img.filename for img in work.images]
        session.delete(work)
        session.commit()
        remove_uploads(images)
        return "", 204


def validate_work_dates(start_value, end_value):
    start_value = str(start_value or "").strip()
    end_value = str(end_value or "").strip()
    if not start_value and not end_value:
        return None, None, None
    if end_value and not start_value:
        return None, None, "Informe a data de inicio antes da data de termino."
    try:
        start_date = date.fromisoformat(start_value).isoformat()
        end_date = date.fromisoformat(end_value).isoformat() if end_value else None
    except ValueError:
        return None, None, "Uma das datas informadas e invalida."
    if end_date and end_date < start_date:
        return None, None, "A data de termino nao pode ser anterior ao inicio."
    return start_date, end_date, None


@app.route("/api/works", methods=["GET"])
def scheduled_works():
    with Session() as session:
        works = session.query(Work).filter((Work.start_date.isnot(None)) | (Work.scheduled_date.isnot(None))).order_by(Work.start_date, Work.name).all()
        output = []
        for work in works:
            item = serialize_work(work)
            item["client"] = {"id": work.client.id, "name": work.client.name}
            output.append(item)
        return jsonify(output)


def remove_uploads(names):
    for name in names:
        path = os.path.join(UPLOAD_FOLDER, name)
        if os.path.isfile(path):
            os.remove(path)


@app.route("/api/works/<int:work_id>/images", methods=["POST"])
def upload_images(work_id):
    with Session() as session:
        work = session.get(Work, work_id)
        if not work:
            return error("Obra nao encontrada.", 404)
        files = [f for f in request.files.getlist("images") if f and f.filename]
        if len(files) > 8:
            return error("Envie no maximo 8 imagens.")
        saved = []
        for file in files:
            if file.mimetype not in ALLOWED_IMAGE_TYPES:
                return error(f"O arquivo {file.filename} nao e uma imagem aceita.")
            original = secure_filename(file.filename)
            filename = f"{uuid.uuid4().hex}{os.path.splitext(original)[1].lower()}"
            file.save(os.path.join(UPLOAD_FOLDER, filename))
            work.images.append(WorkImage(filename=filename))
            saved.append(filename)
        session.commit()
        return jsonify({"saved": saved}), 201


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


@app.route("/api/materials/lookup", methods=["POST"])
def material_lookup():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if len(name) < 2:
        return error("Digite um material para pesquisar.")
    serpapi_key = os.environ.get("SERPAPI_KEY")
    ml_token = os.environ.get("ML_ACCESS_TOKEN")
    products = search_public_catalogs(name)
    if products:
        estimate = round(statistics.median([p["price"] for p in products]), 2)
        return jsonify({"name": name, "estimated_price": estimate, "examples": products, "source": "Obramax e Telhanorte"})
    if not serpapi_key and not ml_token:
        return error("Nenhuma loja respondeu a pesquisa agora. Tente novamente em instantes.", 503)
    try:
        if serpapi_key:
            response = requests.get(
                "https://serpapi.com/search.json",
                params={"engine": "google_shopping", "q": name, "gl": "br", "hl": "pt-br", "api_key": serpapi_key},
                timeout=12,
            )
            response.raise_for_status()
            products = []
            for item in response.json().get("shopping_results", []):
                price = item.get("extracted_price")
                if not isinstance(price, (int, float)) or price <= 0:
                    continue
                products.append({
                    "title": item.get("title", "Produto"), "price": round(float(price), 2),
                    "url": item.get("product_link") or item.get("link"),
                    "thumbnail": item.get("thumbnail"), "condition": None,
                })
                if len(products) == 6:
                    break
            source = "Google Shopping"
        else:
            response = requests.get(
                "https://api.mercadolibre.com/sites/MLB/search",
                params={"q": name, "limit": 12},
                headers={"Authorization": f"Bearer {ml_token}", "User-Agent": "ClientesObras/1.0"},
                timeout=12,
            )
            response.raise_for_status()
            products = []
            for item in response.json().get("results", []):
                price = item.get("price")
                if not isinstance(price, (int, float)) or price <= 0:
                    continue
                products.append({
                    "title": item.get("title", "Produto"), "price": round(float(price), 2),
                    "url": item.get("permalink"),
                    "thumbnail": (item.get("thumbnail") or "").replace("http://", "https://"),
                    "condition": item.get("condition"),
                })
                if len(products) == 6:
                    break
            source = "Mercado Livre"
        estimate = round(statistics.median([p["price"] for p in products]), 2) if products else None
        return jsonify({"name": name, "estimated_price": estimate, "examples": products, "source": source})
    except requests.RequestException:
        return error("O provedor de precos recusou a consulta. Verifique a credencial e tente novamente.", 503)


def search_public_catalogs(name):
    catalogs = (
        ("Obramax", "https://www.obramax.com.br/api/catalog_system/pub/products/search/"),
        ("Telhanorte", "https://www.telhanorte.com.br/api/catalog_system/pub/products/search/"),
    )
    products = []
    seen = set()
    for store, url in catalogs:
        try:
            response = requests.get(
                f"{url}?ft={quote(name, safe='')}",
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10,
            )
            response.raise_for_status()
            for item in response.json():
                sku = (item.get("items") or [{}])[0]
                seller = (sku.get("sellers") or [{}])[0]
                offer = seller.get("commertialOffer") or {}
                price = offer.get("Price")
                title = item.get("productName")
                link = item.get("link")
                if not title or not link or not isinstance(price, (int, float)) or price <= 0:
                    continue
                key = title.casefold()
                if key in seen:
                    continue
                seen.add(key)
                images = sku.get("images") or []
                products.append({
                    "title": title,
                    "price": round(float(price), 2),
                    "url": link,
                    "thumbnail": images[0].get("imageUrl") if images else None,
                    "condition": "new",
                    "store": store,
                })
                if len(products) == 6:
                    return products
        except (requests.RequestException, ValueError, TypeError):
            continue
    return products


@app.route("/api/services/suggest", methods=["POST"])
def suggest_service_percentage():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip().casefold()
    if len(name) < 2:
        return error("Descreva o servico para obter uma sugestao.")
    categories = (
        (("eletric", "energia", "quadro", "fiação", "fiacao"), "Instalacao eletrica", 25.84),
        (("hidraulic", "encanamento", "esgoto", "agua", "água"), "Instalacao hidraulica", 24.18),
        (("ar condicionado", "climatiza", "refrigera", "split", "hvac"), "Instalacao predial especializada", 22.12),
        (("fornecimento", "entrega", "material", "equipamento"), "Fornecimento de materiais e equipamentos", 14.02),
    )
    category, percentage = "Construcao ou reforma de edificacao", 22.12
    for keywords, candidate_category, candidate_percentage in categories:
        if any(keyword in name for keyword in keywords):
            category, percentage = candidate_category, candidate_percentage
            break
    return jsonify({
        "percentage": percentage,
        "category": category,
        "reference": "Acordao 2622/2013 - Plenario do TCU",
        "reference_url": "https://pesquisa.apps.tcu.gov.br/doc/acordao-completo/2622/2013/Plen%C3%A1rio",
    })


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1", host="0.0.0.0", port=5000)
