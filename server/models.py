from sqlalchemy import Column, Float, Integer, String, Text, ForeignKey, create_engine, inspect, text
from sqlalchemy.orm import declarative_base, relationship, scoped_session, sessionmaker

Base = declarative_base()
Session = scoped_session(sessionmaker())

class Client(Base):
    __tablename__ = 'clients'
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False, unique=True)
    works = relationship('Work', back_populates='client', cascade='all, delete-orphan')

class Work(Base):
    __tablename__ = 'works'
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, default='')
    service_name = Column(String(200), default='')
    service_percentage = Column(Float, nullable=False, default=22.12)
    scheduled_date = Column(String(10))
    start_date = Column(String(10))
    end_date = Column(String(10))
    client_id = Column(Integer, ForeignKey('clients.id'))
    client = relationship('Client', back_populates='works')
    images = relationship('WorkImage', back_populates='work', cascade='all, delete-orphan')
    materials = relationship('Material', back_populates='work', cascade='all, delete-orphan')

class Material(Base):
    __tablename__ = 'materials'
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    estimated_price = Column(String(100))
    quantity = Column(Float, nullable=False, default=1)
    work_id = Column(Integer, ForeignKey('works.id'))
    work = relationship('Work', back_populates='materials')

class WorkImage(Base):
    __tablename__ = 'work_images'
    id = Column(Integer, primary_key=True)
    filename = Column(String(300), nullable=False)
    work_id = Column(Integer, ForeignKey('works.id'))
    work = relationship('Work', back_populates='images')

def init_db(db_url='sqlite:///data.db'):
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    columns = {column['name'] for column in inspect(engine).get_columns('materials')}
    if 'quantity' not in columns:
        with engine.begin() as connection:
            connection.execute(text('ALTER TABLE materials ADD COLUMN quantity FLOAT NOT NULL DEFAULT 1'))
    work_columns = {column['name'] for column in inspect(engine).get_columns('works')}
    with engine.begin() as connection:
        if 'service_name' not in work_columns:
            connection.execute(text("ALTER TABLE works ADD COLUMN service_name VARCHAR(200) DEFAULT ''"))
        if 'service_percentage' not in work_columns:
            connection.execute(text('ALTER TABLE works ADD COLUMN service_percentage FLOAT NOT NULL DEFAULT 22.12'))
        if 'scheduled_date' not in work_columns:
            connection.execute(text('ALTER TABLE works ADD COLUMN scheduled_date VARCHAR(10)'))
        if 'start_date' not in work_columns:
            connection.execute(text('ALTER TABLE works ADD COLUMN start_date VARCHAR(10)'))
        if 'end_date' not in work_columns:
            connection.execute(text('ALTER TABLE works ADD COLUMN end_date VARCHAR(10)'))
        connection.execute(text('UPDATE works SET start_date = scheduled_date WHERE start_date IS NULL AND scheduled_date IS NOT NULL'))
    return engine, Session
