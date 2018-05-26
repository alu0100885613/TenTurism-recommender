'use strict'
const restify = require('restify')
const request = require('request')
const MongoClient = require('mongodb').MongoClient
var jsrecommender = require("js-recommender")
const MONGO_ADMIN = process.env.DB_ADMIN
const MONGO_PASSWORD = process.env.DB_PASSWORD
const MONGO_NAME = process.env.DB_NAME
const HEROKU_WEBHOOK = process.env.HRK_URL || 'https://ancient-depths-42683.herokuapp.com/'
const MONGO_URI = "mongodb://"+MONGO_ADMIN+":"+MONGO_PASSWORD+"@ds115749.mlab.com:15749/"+MONGO_NAME
const server = restify.createServer({
  name: "DeodatRecommender"
})
const PORT = process.env.PORT || 3000

server.use(restify.plugins.bodyParser())
server.use(restify.plugins.jsonp())

var recommender = new jsrecommender.Recommender({
    alpha: 0.01, // learning rate
    lambda: 0.0, // regularization parameter
    iterations: 500, // maximum number of iterations in the gradient descent algorithm
    kDim: 2 // number of hidden features for each movie
})

var table = new jsrecommender.Table();

function serialize(cadena){

  cadena = cadena.replace("-","€");
  return cadena;
}

function parse(cadena){

  cadena = cadena.replace("€","-");
  return cadena;
}

function sendRecomendation(place,user){

  let pkt = {
    pId: parse(place),
    usR: user
  }

  return request({
    url: HEROKU_WEBHOOK+'recomendation',
    method: 'POST',
    json: true,
    body: pkt
  },(error, response, body) => {
      if(error){
        console.log(response.statusCode)
      } else {
        console.log(place + " sent to " + user)
      }
  })
}

function doMagic(table){
  //console.log(table)
  return new Promise(resolve => {
    let max
    let thePlace
    var model = recommender.fit(table)
    var predicted_table = recommender.transform(table)
    for (var i = 0; i < predicted_table.columnNames.length; ++i) {
        var user = predicted_table.columnNames[i];
        console.log('For user: ' + user);
        max = 0
        thePlace = undefined
        for (var j = 0; j < predicted_table.rowNames.length; ++j) {
            var place = predicted_table.rowNames[j];
            if(isNaN(Math.round(table.getCell(place, user)))) {
              if(Math.round(predicted_table.getCell(place, user)) > max){
                max = Math.round(predicted_table.getCell(place, user))
                thePlace = place
              }
              console.log('Place [' + place + '] has actual rating of ' + Math.round(table.getCell(place, user)));
              console.log('Place [' + place + '] is predicted to have rating ' + Math.round(predicted_table.getCell(place, user)));
            }
        }
        sendRecomendation(thePlace,user)
    }
    resolve(true)
  }).catch((error)=>{
    console.log("Promise error: "+error)
  })

}

function getCountPlaceDocs(MyMongodb) {
    return new Promise(resolve => {
      resolve(MyMongodb.collection("places").find({}, { place_id: 1 }).count())
    })
}

function getCountUsersDoc(MyMongodb) {
    return new Promise(resolve => {
      resolve(MyMongodb.collection("telegramUsers").find({}, { userId: 1 , fav_place:1 }).count())
    })
}

function getPlaceCursor(MyMongodb) {
    return new Promise(resolve => {
      resolve(MyMongodb.collection("places").find({}, { place_id: 1 }))
    })
}

function getUserCursor(MyMongodb) {
    return new Promise(resolve => {
      resolve(MyMongodb.collection("telegramUsers").find({}, { userId: 1 , fav_place:1 }))
    })
}

function insertEverything(pkg){
  let pCount = 0
  let uCount = 0
  return new Promise(resolve => {
    pkg.placecursor.forEach(function(myDoc) {
      table.addRowIfNotExists(serialize(myDoc.place_id));
      pCount++
      console.log(pCount)
      if(pCount === pkg.countplaces){
        pkg.usercursor.forEach(function(myDoc) {
          let size = myDoc.fav_place.all.length
          let allPlaces = myDoc.fav_place.all
          let userId = myDoc.userId
          let place
          //console.log("size: "+size+", allplaces: "+allPlaces+", userId: "+userId)
          if(myDoc.type === "private"){
            for(let i = 0 ; i < size ; i++){
              place = serialize(allPlaces[i][0])
              table.setCell(place,userId.toString(),10)
            }
          }
          uCount++
          if(uCount === pkg.countusers){
            resolve(true)
          }
        })
      }
    })
  })
}

async function f1() {
    let db = await MongoClient.connect(MONGO_URI)
    let MyMongodb = db.db("tfturismbotdb")
    let nPlaces = await getCountPlaceDocs(MyMongodb)
    let nUsers = await getCountUsersDoc(MyMongodb)
    let myPlaceCursor = await getPlaceCursor(MyMongodb)
    let myUserCursor = await getUserCursor(MyMongodb)

    let paquetito = {
      countplaces: nPlaces,
      countusers: nUsers,
      db: MyMongodb,
      placecursor: myPlaceCursor,
      usercursor: myUserCursor
    }

    await insertEverything(paquetito)
    let y = await doMagic(table)
    console.log(y)
}
//cada día
setInterval(function(){
  f1()
},86400000);


server.listen(PORT, () => console.log(`DeodatRecommender listening on port ${PORT}`))
